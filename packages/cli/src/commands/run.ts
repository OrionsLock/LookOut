import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig, type ResolvedLookoutConfig } from "@lookout/config";
import { createClient, type LLMClient, type LLMConfig } from "@lookout/llm";
import { createStore } from "@lookout/store";
import { writeReport } from "@lookout/reporter";

type Telemetry = {
  inputTokens: number;
  outputTokens: number;
  planCalls: number;
  scoreCalls: number;
};

type FailLevel = "major";

function llmClientConfig(llm: ResolvedLookoutConfig["llm"]): LLMConfig {
  const c: LLMConfig = {
    provider: llm.provider,
    model: llm.model,
    vision: llm.vision,
    maxTokens: llm.maxTokens,
  };
  if (llm.apiKey !== undefined) c.apiKey = llm.apiKey;
  if (llm.baseUrl !== undefined) c.baseUrl = llm.baseUrl;
  return c;
}

function createTrackedLlm(
  llm: ResolvedLookoutConfig["llm"],
  telemetry: Telemetry,
): LLMClient {
  const base = createClient(llmClientConfig(llm), {
    onUsage: (u) => {
      telemetry.inputTokens += u.inputTokens;
      telemetry.outputTokens += u.outputTokens;
    },
  });
  return {
    planAction: async (input) => {
      telemetry.planCalls++;
      return base.planAction(input);
    },
    scoreUX: async (input) => {
      telemetry.scoreCalls++;
      return base.scoreUX(input);
    },
  };
}

function exitCodeFor(
  verdict: string,
  _failLevel: FailLevel,
  issues: { severity: string }[],
): number {
  if (verdict === "errors") return 2;
  const severityOrder = ["critical", "major", "minor", "info"] as const;
  const failIdx = severityOrder.indexOf("major");
  const hit = issues.some((i) => {
    const idx = severityOrder.indexOf(i.severity as (typeof severityOrder)[number]);
    return idx >= 0 && idx <= failIdx;
  });
  if (verdict === "regressions" || hit) return 1;
  return 0;
}

async function cmdRun(opts: {
  url?: string | undefined;
  goal?: string | undefined;
  headed?: boolean | undefined;
  maxSteps?: string | undefined;
  verbose?: boolean | undefined;
  quiet?: boolean | undefined;
  noReport?: boolean | undefined;
  noOpen?: boolean | undefined;
  cwd: string;
  configFile?: string | undefined;
}) {
  const cfgRes = await loadConfig(opts.cwd, opts.configFile ? { configFile: opts.configFile } : undefined);
  if (!cfgRes.ok) {
    process.stderr.write(chalk.red(`Config error: ${JSON.stringify(cfgRes.error)}\n`));
    process.exit(2);
  }
  let config = cfgRes.value;
  if (opts.url) {
    config = { ...config, baseUrl: opts.url };
  }
  if (opts.maxSteps) {
    const n = Number.parseInt(opts.maxSteps, 10);
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      process.stderr.write(chalk.red(`invalid --max-steps: ${opts.maxSteps} (use integer 1–200)\n`));
      process.exit(2);
    }
    config = { ...config, crawl: { ...config.crawl, maxStepsPerGoal: n } };
  }
  if (opts.goal) {
    const g = config.crawl.goals.filter((x) => x.id === opts.goal);
    if (!g.length) {
      process.stderr.write(chalk.red(`goal not found: ${opts.goal}\n`));
      process.exit(2);
    }
    config = { ...config, crawl: { ...config.crawl, goals: g } };
  }

  const { createOrchestrator, createLogger } = await import("@lookout/core");

  const storePath = path.join(opts.cwd, ".lookout");
  const store = createStore(storePath);
  const telemetry: Telemetry = { inputTokens: 0, outputTokens: 0, planCalls: 0, scoreCalls: 0 };
  const llm = createTrackedLlm(config.llm, telemetry);

  const log = createLogger("cli", {
    json: !process.stdout.isTTY,
    level: opts.verbose ? "debug" : opts.quiet ? "warn" : "info",
  });
  const orch = createOrchestrator({
    config,
    store,
    llm,
    logger: log,
    headed: opts.headed ?? false,
    telemetry,
  });

  const res = await orch.run();
  if (!res.ok) {
    process.stderr.write(chalk.red(`${res.error.kind}: ${JSON.stringify(res.error)}\n`));
    process.exit(2);
  }

  const runId = res.value.runId;
  if (!opts.noReport && config.report.format.includes("html")) {
    const reportPath = path.join(storePath, "runs", runId, "report.html");
    await writeReport({ store, runId, outPath: reportPath });
    if (config.report.openAfterRun && !opts.noOpen && process.stdout.isTTY) {
      const { default: open } = await import("open");
      await open(reportPath);
    }
  }

  const issues = await store.listIssuesForRun(runId);
  const code = exitCodeFor(res.value.verdict, "major", issues);
  process.exit(code);
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--config <file>", "config file path (relative to cwd or absolute)")
    .option("--url <url>")
    .option("--goal <id>")
    .option("--headed")
    .option("--max-steps <n>")
    .option("-v, --verbose")
    .option("-q, --quiet")
    .option("--no-report")
    .option("--no-open")
    .action(
      async (o: {
        cwd?: string;
        config?: string;
        url?: string;
        goal?: string;
        headed?: boolean;
        maxSteps?: string;
        verbose?: boolean;
        quiet?: boolean;
        noReport?: boolean;
        noOpen?: boolean;
      }) =>
        cmdRun({
          cwd: path.resolve(o.cwd ?? process.cwd()),
          configFile: o.config,
          url: o.url,
          goal: o.goal,
          headed: o.headed,
          maxSteps: o.maxSteps,
          verbose: o.verbose,
          quiet: o.quiet,
          noReport: o.noReport,
          noOpen: o.noOpen,
        }),
    );
}
