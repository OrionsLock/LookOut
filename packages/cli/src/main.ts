import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { loadConfig, type ResolvedLookoutConfig } from "@lookout/config";
import {
  judgeRunMarkdown,
  suggestHealingMarkdown,
  type LLMConfig,
} from "@lookout/llm";
import { buildRunExportBundle, createStore, diffIssuesByFingerprint } from "@lookout/store";
import { emitAll, type EmitSpecInput } from "@lookout/emitter-playwright";
import { registerRunCommand } from "./commands/run.js";
import { registerCiCommand } from "./commands/ci.js";

function emitAuthFromConfig(config: ResolvedLookoutConfig): EmitSpecInput["auth"] {
  if (config.auth.type === "credentials") {
    return {
      type: "credentials",
      loginUrl: new URL(config.auth.loginUrl, config.baseUrl).toString(),
      usernameSelector: config.auth.usernameSelector,
      passwordSelector: config.auth.passwordSelector,
      submitSelector: config.auth.submitSelector,
    };
  }
  if (config.auth.type === "storageState") {
    return { type: "storageState", storageStatePath: config.auth.path };
  }
  return { type: "none" };
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

function formatHealMarkdown(runId: string, goals: { id: string; status: string; prompt: string }[], issues: { severity: string; title: string; category: string; detail: unknown }[]): string {
  const lines = [`# Run ${runId}`, "", "## Goals", ...goals.map((g) => `- **${g.id}** (${g.status}): ${g.prompt}`), "", "## Issues", ...issues.map((i) => `- [${i.severity}/${i.category}] ${i.title}: \`${JSON.stringify(i.detail).slice(0, 500)}\``)];
  return lines.join("\n");
}

async function cmdRunsList(opts: { cwd: string; limit: number; json: boolean }) {
  const store = createStore(path.join(opts.cwd, ".lookout"));
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  const runs = await store.listRuns({ limit: opts.limit });
  if (opts.json) {
    process.stdout.write(JSON.stringify({ runs }, null, 2) + "\n");
    return;
  }
  if (!runs.length) {
    process.stdout.write("(no runs)\n");
    return;
  }
  for (const r of runs) {
    const sum = r.summary && typeof r.summary === "object" ? JSON.stringify(r.summary) : "";
    process.stdout.write(
      `${r.id}\t${r.verdict}\t${r.baseUrl}\tendedAt=${r.endedAt ?? "—"}\t${sum.slice(0, 120)}${sum.length > 120 ? "…" : ""}\n`,
    );
  }
}

async function cmdRunsDiff(opts: { cwd: string; runA: string; runB: string; json: boolean }) {
  const store = createStore(path.join(opts.cwd, ".lookout"));
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  const [ra, rb] = await Promise.all([store.getRun(opts.runA), store.getRun(opts.runB)]);
  if (!ra || !rb) {
    process.stderr.write(chalk.red("run not found (check run ids)\n"));
    process.exit(2);
  }
  const [issuesA, issuesB] = await Promise.all([
    store.listIssuesForRun(opts.runA),
    store.listIssuesForRun(opts.runB),
  ]);
  const diff = diffIssuesByFingerprint(issuesA, issuesB);
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          runA: { id: ra.id, verdict: ra.verdict, baseUrl: ra.baseUrl },
          runB: { id: rb.id, verdict: rb.verdict, baseUrl: rb.baseUrl },
          onlyInA: diff.onlyInA,
          onlyInB: diff.onlyInB,
          inBoth: diff.inBoth,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  process.stdout.write(chalk.bold(`Compare ${opts.runA} (A) vs ${opts.runB} (B)\n\n`));
  process.stdout.write(chalk.yellow(`Only in A (${diff.onlyInA.length})\n`));
  for (const i of diff.onlyInA) {
    process.stdout.write(`  [${i.severity}/${i.category}] ${i.title}\n`);
  }
  process.stdout.write(chalk.yellow(`\nOnly in B (${diff.onlyInB.length})\n`));
  for (const i of diff.onlyInB) {
    process.stdout.write(`  [${i.severity}/${i.category}] ${i.title}\n`);
  }
  process.stdout.write(chalk.green(`\nIn both (${diff.inBoth.length})\n`));
  for (const i of diff.inBoth) {
    process.stdout.write(`  [${i.severity}/${i.category}] ${i.title}\n`);
  }
  process.stdout.write("\n");
}

async function cmdRunsEmitPlaywright(opts: {
  cwd: string;
  runId: string;
  out: string;
  force?: boolean | undefined;
  configFile?: string | undefined;
}) {
  const cfgRes = await loadConfig(opts.cwd, opts.configFile ? { configFile: opts.configFile } : undefined);
  if (!cfgRes.ok) {
    process.stderr.write(chalk.red(`Config error: ${JSON.stringify(cfgRes.error)}\n`));
    process.exit(2);
  }
  const config = cfgRes.value;
  const store = createStore(path.join(opts.cwd, ".lookout"));
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  const run = await store.getRun(opts.runId);
  if (!run) {
    process.stderr.write(chalk.red("run not found\n"));
    process.exit(2);
  }
  const outDir = path.resolve(opts.cwd, opts.out);
  await emitAll({
    store,
    runId: opts.runId,
    outDir,
    force: opts.force,
    auth: emitAuthFromConfig(config),
  });
  process.stdout.write(chalk.green(`emitted Playwright specs for run ${opts.runId} → ${outDir}\n`));
}

async function cmdRunsExport(opts: { cwd: string; runId: string; out: string }) {
  const storeRoot = path.join(opts.cwd, ".lookout");
  const store = createStore(storeRoot);
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  const bundle = await buildRunExportBundle(store, storeRoot, opts.cwd, opts.runId);
  if (!bundle) {
    process.stderr.write(chalk.red("run not found\n"));
    process.exit(2);
  }
  const fs = await import("node:fs/promises");
  const outPath = path.resolve(opts.cwd, opts.out);
  await fs.writeFile(outPath, JSON.stringify(bundle, null, 2), "utf8");
  process.stdout.write(chalk.green(`wrote ${outPath}\n`));
}

async function cmdInit(opts: { cwd: string; force?: boolean | undefined }) {
  const fs = await import("node:fs/promises");
  const target = path.join(opts.cwd, "lookout.config.ts");
  try {
    await fs.access(target);
    if (!opts.force) {
      process.stderr.write(chalk.red("lookout.config.ts already exists (use --force)\n"));
      process.exit(2);
    }
  } catch {
    // ok
  }
  const body = `import { defineConfig } from "@lookout/config";

export default defineConfig({
  baseUrl: "http://localhost:3000",
  crawl: {
    goals: [
      { id: "smoke", prompt: "12345678901 smoke test" },
    ],
  },
});
`;
  await fs.writeFile(target, body, "utf8");
  const gitignore = path.join(opts.cwd, ".gitignore");
  let gi = "";
  try {
    gi = await fs.readFile(gitignore, "utf8");
  } catch {
    gi = "";
  }
  if (!gi.includes(".lookout/")) {
    await fs.appendFile(gitignore, "\n.lookout/\n", "utf8");
  }
  process.stdout.write(chalk.green("Created lookout.config.ts and ensured .gitignore contains .lookout/\n"));
}

async function cmdBaseline(sub: string, opts: { cwd: string; yes?: boolean | undefined }) {
  const { createStore } = await import("@lookout/store");
  const store = createStore(path.join(opts.cwd, ".lookout"));
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  if (sub === "list") {
    process.stdout.write("(baselines are stored under .lookout/baseline/)\n");
    process.exit(0);
  }
  if (sub === "clear") {
    const n = await store.clearBaselines();
    process.stdout.write(chalk.green(`cleared ${n} baselines\n`));
    process.exit(0);
  }
  if (sub === "promote") {
    const runs = await store.listRuns({ limit: 1 });
    const run = runs[0];
    if (!run) {
      process.stderr.write(chalk.red("no runs found\n"));
      process.exit(2);
    }
    const steps = await listAllSteps(store, run.id);
    const lastShot = new Map<string, string>();
    for (const s of steps) {
      if (s.screenshotAfter) lastShot.set(s.url, s.screenshotAfter);
    }
    const fs = await import("node:fs/promises");
    for (const [u, rel] of lastShot) {
      const buf = await fs.readFile(path.join(store.rootDir, rel));
      await store.putBaseline({ url: u, screenshotBytes: buf, runId: run.id });
    }
    process.stdout.write(chalk.green(`promoted baselines for ${lastShot.size} urls\n`));
    process.exit(0);
  }
  process.stderr.write(chalk.red("unknown baseline subcommand\n"));
  process.exit(2);
}

async function listAllSteps(
  store: Awaited<ReturnType<typeof createStore>>,
  runId: string,
): Promise<Array<{ url: string; screenshotAfter: string | null }>> {
  const goals = await store.listGoalsForRun(runId);
  const out: Array<{ url: string; screenshotAfter: string | null }> = [];
  for (const g of goals) {
    for (const s of await store.listStepsForGoal(g.id)) {
      out.push({ url: s.url, screenshotAfter: s.screenshotAfter });
    }
  }
  return out;
}

async function cmdHeal(opts: {
  cwd: string;
  configFile?: string | undefined;
  run?: string | undefined;
  out?: string | undefined;
}) {
  const cfgRes = await loadConfig(opts.cwd, opts.configFile ? { configFile: opts.configFile } : undefined);
  if (!cfgRes.ok) {
    process.stderr.write(chalk.red(`Config error: ${JSON.stringify(cfgRes.error)}\n`));
    process.exit(2);
  }
  const config = cfgRes.value;
  const store = createStore(path.join(opts.cwd, ".lookout"));
  const init = await store.init();
  if (!init.ok) process.exit(2);
  const runs = await store.listRuns({ limit: 20 });
  const runId = opts.run ?? runs[0]?.id;
  if (!runId) {
    process.stderr.write(chalk.red("no run found\n"));
    process.exit(2);
  }
  const goals = await store.listGoalsForRun(runId);
  const issues = await store.listIssuesForRun(runId);
  const md = formatHealMarkdown(
    runId,
    goals.map((g) => ({ id: g.id, status: g.status, prompt: g.prompt })),
    issues.map((i) => ({ severity: i.severity, title: i.title, category: i.category, detail: i.detail })),
  );
  const r = await suggestHealingMarkdown(llmClientConfig(config.llm), md);
  if (!r.ok) {
    process.stderr.write(chalk.red(JSON.stringify(r.error) + "\n"));
    process.exit(2);
  }
  const fs = await import("node:fs/promises");
  if (opts.out) {
    await fs.writeFile(path.resolve(opts.cwd, opts.out), r.value, "utf8");
    process.stdout.write(chalk.green(`wrote ${opts.out}\n`));
  } else {
    process.stdout.write(r.value + "\n");
  }
}

async function cmdGenerateTests(opts: {
  cwd: string;
  run?: string | undefined;
  out?: string | undefined;
  force?: boolean | undefined;
  configFile?: string | undefined;
}) {
  const cfgRes = await loadConfig(opts.cwd, opts.configFile ? { configFile: opts.configFile } : undefined);
  if (!cfgRes.ok) {
    process.exit(2);
  }
  const config = cfgRes.value;
  const store = createStore(path.join(opts.cwd, ".lookout"));
  const init = await store.init();
  if (!init.ok) process.exit(2);
  const runs = await store.listRuns({ limit: 1 });
  const runId = opts.run ?? runs[0]?.id;
  if (!runId) {
    process.stderr.write(chalk.red("no run id\n"));
    process.exit(2);
  }
  const auth = emitAuthFromConfig(config);
  const outDir = opts.out ?? config.emitters.playwright.outDir;
  await emitAll({ store, runId, outDir: path.resolve(opts.cwd, outDir), force: opts.force, auth });
  process.stdout.write(chalk.green("generated tests\n"));
}

async function cmdVerifyRun(opts: {
  cwd: string;
  configFile?: string | undefined;
  run?: string | undefined;
  json?: boolean | undefined;
}) {
  const cfgRes = await loadConfig(opts.cwd, opts.configFile ? { configFile: opts.configFile } : undefined);
  if (!cfgRes.ok) {
    process.stderr.write(chalk.red(`Config error: ${JSON.stringify(cfgRes.error)}\n`));
    process.exit(2);
  }
  const config = cfgRes.value;
  const storeRoot = path.join(opts.cwd, ".lookout");
  const store = createStore(storeRoot);
  const init = await store.init();
  if (!init.ok) process.exit(2);
  const runs = await store.listRuns({ limit: 20 });
  const runId = opts.run ?? runs[0]?.id;
  if (!runId) {
    process.stderr.write(chalk.red("no run found\n"));
    process.exit(2);
  }
  const bundle = await buildRunExportBundle(store, storeRoot, opts.cwd, runId);
  if (!bundle) {
    process.stderr.write(chalk.red("run not found\n"));
    process.exit(2);
  }
  const md = [
    "# Lookout run (agent judge input)",
    "",
    "Use the JSON below. Focus on whether major/critical issues represent real regressions vs noise.",
    "",
    "```json",
    JSON.stringify(bundle, null, 2),
    "```",
  ].join("\n");
  const j = await judgeRunMarkdown(llmClientConfig(config.llm), md);
  if (!j.ok) {
    process.stderr.write(chalk.red(JSON.stringify(j.error) + "\n"));
    process.exit(2);
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify({ runId, judge: j.value }, null, 2) + "\n");
  } else {
    process.stdout.write(`${j.value.verdict} (${j.value.confidence}): ${j.value.rationale}\n`);
  }
  process.exit(j.value.verdict === "accept" ? 0 : 1);
}

export async function main(argv: string[]) {
  const program = new Command();
  program.name("lookout").description("AI QA engineer for web apps").version("0.5.0");

  program
    .command("init")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--force")
    .action(async (o: { cwd?: string; force?: boolean }) =>
      cmdInit({ cwd: path.resolve(o.cwd ?? process.cwd()), force: o.force }),
    );

  registerRunCommand(program);

  const runs = program.command("runs").description("List, compare, and export runs from .lookout");

  runs
    .command("list")
    .description("List recent runs")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--limit <n>", "max runs", "20")
    .option("--json", "machine-readable JSON")
    .action(async (o: { cwd?: string; limit?: string; json?: boolean }) =>
      cmdRunsList({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        limit: Math.max(1, Math.min(500, Number(o.limit ?? 20) || 20)),
        json: Boolean(o.json),
      }),
    );

  runs
    .command("diff")
    .description("Compare issues between two run ids (fingerprint: severity + category + title)")
    .argument("<runIdA>", "first run id")
    .argument("<runIdB>", "second run id")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--json", "machine-readable JSON")
    .action(async (runIdA: string, runIdB: string, o: { cwd?: string; json?: boolean }) =>
      cmdRunsDiff({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        runA: runIdA,
        runB: runIdB,
        json: Boolean(o.json),
      }),
    );

  runs
    .command("export")
    .description(
      "Export run bundle as JSON v2 (run, goals, goalSteps, issues, report path, trace*.zip paths) for CI or sharing",
    )
    .argument("<runId>")
    .requiredOption("--out <file>", "output path (relative to cwd or absolute)")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .action(async (runId: string, o: { cwd?: string; out: string }) =>
      cmdRunsExport({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        runId,
        out: o.out,
      }),
    );

  runs
    .command("emit-playwright")
    .description(
      "Emit Playwright .spec.ts files from a run's completed goals (same as generate-tests; only goals with status complete)",
    )
    .argument("<runId>")
    .requiredOption("--out <dir>", "output directory for .spec.ts files")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--config <file>", "config file path (relative to cwd or absolute)")
    .option("--force", "overwrite existing specs")
    .action(
      async (
        runId: string,
        o: { cwd?: string; out: string; config?: string; force?: boolean },
      ) =>
        cmdRunsEmitPlaywright({
          cwd: path.resolve(o.cwd ?? process.cwd()),
          runId,
          out: o.out,
          force: o.force,
          configFile: o.config,
        }),
    );

  registerCiCommand(program);

  program
    .command("report")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .action(async (o: { cwd?: string }) => {
      const cwd = path.resolve(o.cwd ?? process.cwd());
      const { default: open } = await import("open");
      const store = createStore(path.join(cwd, ".lookout"));
      const init = await store.init();
      if (!init.ok) process.exit(2);
      const runs = await store.listRuns({ limit: 1 });
      const id = runs[0]?.id;
      if (!id) process.exit(2);
      await open(path.join(cwd, ".lookout", "runs", id, "report.html"));
    });

  program
    .command("baseline")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .argument("<sub>", "promote|list|clear")
    .option("-y, --yes")
    .action(async (sub: string, o: { cwd?: string; yes?: boolean }) =>
      cmdBaseline(sub, { cwd: path.resolve(o.cwd ?? process.cwd()), yes: o.yes }),
    );

  program
    .command("heal")
    .description("LLM-assisted markdown suggestions from the latest run's issues")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--config <file>", "config file path (relative to cwd or absolute)")
    .option("--run <id>", "run id (default: latest)")
    .option("--out <file>", "write markdown to file instead of stdout")
    .action(async (o: { cwd?: string; config?: string; run?: string; out?: string }) =>
      cmdHeal({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        configFile: o.config,
        run: o.run,
        out: o.out,
      }),
    );

  program
    .command("verify-run")
    .description(
      "LLM-as-judge on a stored run export (accept/reject); exit 0 only if verdict is accept (use after ci in strict pipelines)",
    )
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--config <file>", "config file path (relative to cwd or absolute)")
    .option("--run <id>", "run id (default: latest)")
    .option("--json", "print structured judge output")
    .action(async (o: { cwd?: string; config?: string; run?: string; json?: boolean }) =>
      cmdVerifyRun({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        configFile: o.config,
        run: o.run,
        json: Boolean(o.json),
      }),
    );

  program
    .command("generate-tests")
    .description(
      "Alias for `lookout runs emit-playwright` against the latest run (kept for compatibility; prefer the new form).",
    )
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--config <file>", "config file path (relative to cwd or absolute)")
    .option("--run <id>")
    .option("--out <dir>")
    .option("--force")
    .action(async (o: { cwd?: string; config?: string; run?: string; out?: string; force?: boolean }) =>
      cmdGenerateTests({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        configFile: o.config,
        run: o.run,
        out: o.out,
        force: o.force,
      }),
    );

  await program.parseAsync(argv);
}

main(process.argv).catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(2);
});
