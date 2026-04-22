import path from "node:path";
import type { Command } from "commander";
import { loadConfig, type ResolvedLookoutConfig } from "@lookout/config";
import { createClient, type LLMClient, type LLMConfig } from "@lookout/llm";
import { createStore } from "@lookout/store";
import { writeJunitXml, writeReport } from "@lookout/reporter";

type Telemetry = {
  inputTokens: number;
  outputTokens: number;
  planCalls: number;
  scoreCalls: number;
};

const FAIL_LEVELS = ["critical", "major", "minor"] as const;
type FailLevel = (typeof FAIL_LEVELS)[number];

function parseFailLevel(raw: string | undefined, fallback: FailLevel = "major"): FailLevel {
  if (raw === undefined) return fallback;
  const ok = (FAIL_LEVELS as readonly string[]).includes(raw);
  if (!ok) {
    process.stderr.write(`invalid --fail-level: ${raw}. Use one of: ${FAIL_LEVELS.join(", ")}\n`);
    process.exit(2);
  }
  return raw as FailLevel;
}

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

function createTrackedLlm(llm: ResolvedLookoutConfig["llm"], telemetry: Telemetry): LLMClient {
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
  failLevel: FailLevel,
  issues: { severity: string }[],
): number {
  if (verdict === "errors") return 2;
  const severityOrder = ["critical", "major", "minor", "info"] as const;
  const failIdx = severityOrder.indexOf(failLevel);
  if (failIdx < 0) {
    throw new Error(`invariant_failed: unknown failLevel ${failLevel}`);
  }
  const hit = issues.some((i) => {
    const idx = severityOrder.indexOf(i.severity as (typeof severityOrder)[number]);
    return idx >= 0 && idx <= failIdx;
  });
  if (verdict === "regressions" || hit) return 1;
  return 0;
}

async function cmdCi(opts: {
  cwd: string;
  junit?: string | undefined;
  failLevel?: string | undefined;
  configFile?: string | undefined;
  retries: number;
  failOnRetryRecovery: boolean;
}) {
  const cfgRes = await loadConfig(opts.cwd, opts.configFile ? { configFile: opts.configFile } : undefined);
  if (!cfgRes.ok) {
    process.stderr.write(JSON.stringify({ level: "error", msg: cfgRes.error }) + "\n");
    process.exit(2);
  }
  const config = cfgRes.value;
  const { createOrchestrator, createLogger } = await import("@lookout/core");
  const storePath = path.join(opts.cwd, ".lookout");
  const store = createStore(storePath);
  const failLevel = parseFailLevel(opts.failLevel);
  const extra = Math.max(0, Math.min(5, Math.floor(opts.retries)));
  const maxAttempts = 1 + extra;

  let lastRunId: string | undefined;
  let lastExitCode = 1;
  let junitWritten = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const telemetry: Telemetry = { inputTokens: 0, outputTokens: 0, planCalls: 0, scoreCalls: 0 };
    const llm = createTrackedLlm(config.llm, telemetry);
    const log = createLogger("cli", { json: true });
    const orch = createOrchestrator({ config, store, llm, logger: log, headed: false, telemetry });
    const res = await orch.run();
    if (!res.ok) {
      process.stderr.write(
        JSON.stringify({ level: "error", phase: "lookout_ci", attempt, maxAttempts, err: res.error }) + "\n",
      );
      if (attempt < maxAttempts) {
        process.stderr.write(
          JSON.stringify({
            level: "info",
            phase: "lookout_ci",
            will_retry: true,
            reason: "orchestrator_failed",
            attempt,
            maxAttempts,
          }) + "\n",
        );
        continue;
      }
      process.exit(2);
    }
    const runId = res.value.runId;
    lastRunId = runId;
    const reportPath = path.join(storePath, "runs", runId, "report.html");
    await writeReport({ store, runId, outPath: reportPath });
    const issues = await store.listIssuesForRun(runId);
    const code = exitCodeFor(res.value.verdict, failLevel, issues);
    lastExitCode = code;
    process.stderr.write(
      JSON.stringify({
        level: "info",
        phase: "lookout_ci",
        attempt,
        maxAttempts,
        runId,
        verdict: res.value.verdict,
        exit_code: code,
      }) + "\n",
    );
    if (code === 0) {
      if (opts.junit) {
        await writeJunitXml({ store, runId, outPath: opts.junit });
        junitWritten = true;
      }
      if (attempt > 1) {
        process.stderr.write(
          JSON.stringify({
            level: "info",
            phase: "lookout_ci",
            flake_suspected: true,
            passed_on_attempt: attempt,
          }) + "\n",
        );
        if (opts.failOnRetryRecovery) {
          process.stderr.write(
            JSON.stringify({
              level: "error",
              phase: "lookout_ci",
              strict_retry_policy: true,
              detail: "fail_on_retry_recovery: a later attempt passed after an earlier failure; exiting 1",
            }) + "\n",
          );
          process.exit(1);
        }
      }
      process.exit(0);
    }
    if (attempt < maxAttempts) {
      process.stderr.write(
        JSON.stringify({
          level: "info",
          phase: "lookout_ci",
          will_retry: true,
          attempt,
          maxAttempts,
          exit_code: code,
        }) + "\n",
      );
    }
  }

  if (opts.junit && lastRunId && !junitWritten) {
    await writeJunitXml({ store, runId: lastRunId, outPath: opts.junit });
  }
  process.exit(lastExitCode);
}

export function registerCiCommand(program: Command): void {
  program
    .command("ci")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--config <file>", "config file path (relative to cwd or absolute)")
    .option("--junit <path>")
    .option("--fail-level <level>")
    .option(
      "--retries <n>",
      "extra full-run attempts after a failing exit (0-5); exit 0 if any attempt passes; stderr JSON lines include flake_suspected when a later attempt passes",
      "0",
    )
    .option(
      "--strict-retry",
      "with --retries: exit 1 if a later attempt passes after an earlier failure (CI cannot be saved by a retry alone)",
    )
    .action(
      async (o: {
        cwd?: string;
        config?: string;
        junit?: string;
        failLevel?: string;
        retries?: string;
        strictRetry?: boolean;
      }) =>
        cmdCi({
          cwd: path.resolve(o.cwd ?? process.cwd()),
          configFile: o.config,
          junit: o.junit,
          failLevel: o.failLevel,
          retries: Math.min(5, Math.max(0, Number.parseInt(String(o.retries ?? "0"), 10) || 0)),
          failOnRetryRecovery: Boolean(o.strictRetry),
        }),
    );
}
