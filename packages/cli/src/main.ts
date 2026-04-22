import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { loadConfig, loadPolicyPack, POLICY_INIT_TEMPLATE, type ResolvedLookoutConfig } from "@lookout/config";
import {
  diagnoseFlakeMarkdown,
  judgeRunMarkdown,
  suggestHealingMarkdown,
  suggestRepairUnifiedDiffMarkdown,
} from "@lookout/llm";
import {
  buildRunExportBundle,
  createStore,
  diffIssuesByFingerprint,
  summarizeFlakePairMarkdown,
} from "@lookout/store";
import { writeReport, writeJunitXml } from "@lookout/reporter";
import { emitAll, type EmitSpecInput } from "@lookout/emitter-playwright";
import { digestPlaywrightTraceZip } from "@lookout/analyzers";
import { buildFlakeSuspectedPayload } from "./ci-flake-diagnostics.js";
import { extractUnifiedDiffFromHealMarkdown, tryApplyUnifiedDiff } from "./apply-heal-diff.js";
import { findFlakePairFromStderrLog } from "./flake-stderr-parse.js";
import {
  createTrackedLlm,
  emitAuthFromConfig,
  exitCodeFor,
  formatHealMarkdown,
  llmClientConfig,
  type Telemetry,
  parseFailLevel,
} from "./commands/_shared.js";

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

  const log = createLogger("cli", { json: !process.stdout.isTTY, level: opts.verbose ? "debug" : opts.quiet ? "warn" : "info" });
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

async function cmdCi(opts: {
  cwd: string;
  junit?: string | undefined;
  failLevel?: string | undefined;
  configFile?: string | undefined;
  retries: number;
  /** If true, exit 1 when a later attempt passes after an earlier failure (strict CI; avoids silent flake recovery). */
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
  // `opts.retries` is already clamped to [0, 5] by the commander action; keep
  // this trusting-but-verified since we'd rather fail closed than silently.
  const extra = Math.max(0, Math.min(5, Math.floor(opts.retries)));
  const maxAttempts = 1 + extra;

  let lastRunId: string | undefined;
  let lastExitCode = 1;
  let junitWritten = false;
  /** Last completed run that exited non-zero; used when a retry later passes (`flake_suspected`). */
  let priorFailedRunId: string | undefined;

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
            ...buildFlakeSuspectedPayload({
              passedOnAttempt: attempt,
              passedRunId: runId,
              priorFailedRunId,
            }),
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
      priorFailedRunId = undefined;
      process.exit(0);
    }
    priorFailedRunId = runId;
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

async function cmdRunsDiagnoseFlake(opts: {
  cwd: string;
  failRunId: string;
  passRunId: string;
  json?: boolean | undefined;
  configFile?: string | undefined;
  /** Include machine-extracted trace NDJSON digests (first trace zip per run). */
  withTraceDigests?: boolean | undefined;
}) {
  const cfgRes = await loadConfig(opts.cwd, opts.configFile ? { configFile: opts.configFile } : undefined);
  if (!cfgRes.ok) {
    process.stderr.write(chalk.red(`Config error: ${JSON.stringify(cfgRes.error)}\n`));
    process.exit(2);
  }
  const polRes = await loadPolicyPack(opts.cwd);
  if (!polRes.ok) {
    process.stderr.write(chalk.red(`lookout.policy.json: ${JSON.stringify(polRes.error)}\n`));
    process.exit(2);
  }
  const policy = polRes.value;
  const config = cfgRes.value;
  const storeRoot = path.join(opts.cwd, ".lookout");
  const store = createStore(storeRoot);
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  const [failBundle, passBundle] = await Promise.all([
    buildRunExportBundle(store, storeRoot, opts.cwd, opts.failRunId),
    buildRunExportBundle(store, storeRoot, opts.cwd, opts.passRunId),
  ]);
  if (!failBundle || !passBundle) {
    process.stderr.write(chalk.red("one or both runs not found\n"));
    process.exit(2);
  }
  const summary = summarizeFlakePairMarkdown(failBundle, passBundle);
  let traceExtra = "";
  if (opts.withTraceDigests) {
    const chunks: string[] = ["\n\n## Trace digest (fail run, first zip)\n"];
    const fr = failBundle.artifacts.traceZips[0];
    if (fr) {
      const d = await digestPlaywrightTraceZip(path.resolve(opts.cwd, fr), { maxOutChars: 8000 });
      chunks.push(`### ${fr}\n\n\`\`\`text\n${d}\n\`\`\`\n`);
    } else {
      chunks.push("_(no trace zip on fail run)_\n");
    }
    chunks.push("\n## Trace digest (pass run, first zip)\n");
    const pr = passBundle.artifacts.traceZips[0];
    if (pr) {
      const d = await digestPlaywrightTraceZip(path.resolve(opts.cwd, pr), { maxOutChars: 8000 });
      chunks.push(`### ${pr}\n\n\`\`\`text\n${d}\n\`\`\`\n`);
    } else {
      chunks.push("_(no trace zip on pass run)_\n");
    }
    traceExtra = chunks.join("");
  }
  const md = [
    "# Flake pair (fail vs pass)",
    "",
    "The fail run should be the one that exited badly first; the pass run is typically a later retry that succeeded.",
    "",
    summary,
    traceExtra,
  ].join("\n");
  const d = await diagnoseFlakeMarkdown(llmClientConfig(config.llm), md);
  if (!d.ok) {
    process.stderr.write(chalk.red(JSON.stringify(d.error) + "\n"));
    process.exit(2);
  }
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          failRunId: opts.failRunId,
          passRunId: opts.passRunId,
          diagnosis: d.value,
          policyExitNonZeroVerdicts: policy.flakeDiagnose.exitNonZeroVerdicts,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(
      `${d.value.verdict} (${d.value.confidence}): ${d.value.rationale}\n\nRecommended:\n${d.value.recommended_actions.map((a) => `- ${a}`).join("\n")}\n`,
    );
  }
  const exit1 = policy.flakeDiagnose.exitNonZeroVerdicts.includes(d.value.verdict);
  process.exit(exit1 ? 1 : 0);
}

async function cmdRunsParseFlakeStderr(opts: { file: string }) {
  const fs = await import("node:fs/promises");
  const abs = path.resolve(opts.file);
  let text: string;
  try {
    text = await fs.readFile(abs, "utf8");
  } catch (e) {
    process.stderr.write(chalk.red(`could not read file: ${abs} (${e})\n`));
    process.exit(2);
  }
  const pair = findFlakePairFromStderrLog(text);
  if (pair) {
    process.stdout.write(`${pair.priorFailedRunId} ${pair.passedRunId}\n`);
  }
}

async function cmdPolicy(sub: string, opts: { cwd: string; force?: boolean | undefined }) {
  const fs = await import("node:fs/promises");
  const target = path.join(opts.cwd, "lookout.policy.json");
  if (sub === "show") {
    const r = await loadPolicyPack(opts.cwd);
    if (!r.ok) {
      process.stderr.write(chalk.red(`lookout.policy.json: ${JSON.stringify(r.error)}\n`));
      process.exit(2);
    }
    process.stdout.write(JSON.stringify(r.value, null, 2) + "\n");
    return;
  }
  if (sub === "validate") {
    const r = await loadPolicyPack(opts.cwd);
    if (!r.ok) {
      process.stderr.write(chalk.red(`lookout.policy.json: ${JSON.stringify(r.error)}\n`));
      process.exit(2);
    }
    process.stdout.write(chalk.green("lookout.policy.json is valid\n"));
    return;
  }
  if (sub === "init") {
    try {
      await fs.access(target);
      if (!opts.force) {
        process.stderr.write(chalk.red("lookout.policy.json already exists (use --force)\n"));
        process.exit(2);
      }
    } catch {
      // ok
    }
    await fs.writeFile(target, `${POLICY_INIT_TEMPLATE.trim()}\n`, "utf8");
    process.stdout.write(chalk.green(`wrote ${target}\n`));
    return;
  }
  process.stderr.write(chalk.red("unknown policy subcommand (use show|validate|init)\n"));
  process.exit(2);
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

function clipForPrompt(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n/* …truncated (${s.length} chars total) */\n`;
}

async function cmdHeal(opts: {
  cwd: string;
  configFile?: string | undefined;
  run?: string | undefined;
  out?: string | undefined;
  /** When set, include this Playwright spec plus trace digests and ask the model for a unified diff (## Proposed spec edits). */
  spec?: string | undefined;
  /** Apply first ```diff from model output to `--spec` (requires `--spec`; writes `*.lookout-heal.bak` on success). */
  apply?: boolean | undefined;
  /** With `--apply`: verify patch applies but do not write files (CI-safe rehearsal). */
  dryRun?: boolean | undefined;
  /** After a failed apply, ask the model to repair the unified diff (also set heal.repairOnApplyFailure in lookout.policy.json). */
  repair?: boolean | undefined;
}) {
  const cfgRes = await loadConfig(opts.cwd, opts.configFile ? { configFile: opts.configFile } : undefined);
  if (!cfgRes.ok) {
    process.stderr.write(chalk.red(`Config error: ${JSON.stringify(cfgRes.error)}\n`));
    process.exit(2);
  }
  const polRes = await loadPolicyPack(opts.cwd);
  if (!polRes.ok) {
    process.stderr.write(chalk.red(`lookout.policy.json: ${JSON.stringify(polRes.error)}\n`));
    process.exit(2);
  }
  const policy = polRes.value;
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
  if (opts.apply && !opts.spec) {
    process.stderr.write(chalk.red("--apply requires --spec (path to the Playwright file to patch)\n"));
    process.exit(2);
  }
  if (opts.dryRun && !opts.apply) {
    process.stderr.write(chalk.red("--dry-run requires --apply\n"));
    process.exit(2);
  }
  if (opts.apply && process.env["CI"] === "true" && process.env["LOOKOUT_HEAL_APPLY"] !== "1") {
    process.stderr.write(
      chalk.red(
        "refusing --apply while CI=true unless LOOKOUT_HEAL_APPLY=1 (avoids accidental spec writes in pipelines)\n",
      ),
    );
    process.exit(2);
  }

  const fs = await import("node:fs/promises");
  let specAbs: string | undefined;
  let specSrc: string | undefined;
  if (opts.spec) {
    specAbs = path.resolve(opts.cwd, opts.spec);
    try {
      specSrc = await fs.readFile(specAbs, "utf8");
    } catch (e) {
      process.stderr.write(chalk.red(`could not read --spec file: ${specAbs} (${e})\n`));
      process.exit(2);
    }
  }

  const goals = await store.listGoalsForRun(runId);
  const issues = await store.listIssuesForRun(runId);
  const storeRoot = path.join(opts.cwd, ".lookout");
  const bundle = await buildRunExportBundle(store, storeRoot, opts.cwd, runId);
  let artifactTail = "";
  if (bundle) {
    artifactTail = `\n\n## Bundled artifacts\n- HTML report: \`${bundle.artifacts.reportHtmlRelative}\`\n`;
    if (bundle.artifacts.traceZips.length) {
      artifactTail += bundle.artifacts.traceZips
        .map(
          (rel) =>
            `- Playwright trace \`${rel}\` — inspect: \`npx playwright show-trace ${path.resolve(opts.cwd, rel)}\``,
        )
        .join("\n");
      artifactTail += "\n";
    }
    artifactTail +=
      "\nWhen suggesting selector fixes, prefer `getByRole` / accessible names aligned with the a11y tree snapshots stored per step (see goalSteps in `lookout runs export`).\n";
  }

  let traceDigestBlock = "";
  if (opts.spec && bundle?.artifacts.traceZips.length) {
    const maxZips = 2;
    const parts: string[] = [
      "\n\n## Playwright trace digest (machine-extracted from NDJSON inside trace zip)\n",
    ];
    for (const rel of bundle.artifacts.traceZips.slice(0, maxZips)) {
      const absZip = path.resolve(opts.cwd, rel);
      const digest = await digestPlaywrightTraceZip(absZip, { maxOutChars: 12_000 });
      parts.push(`### ${rel}\n\n\`\`\`text\n${digest}\n\`\`\`\n`);
    }
    traceDigestBlock = parts.join("\n");
  } else if (opts.spec) {
    traceDigestBlock =
      "\n\n## Playwright trace digest\n\n_(no `trace*.zip` found for this run — enable `report.traceOnFailure` in config and reproduce a failing goal, or use `lookout ci` with tracing on failure.)_\n";
  }

  let specBlock = "";
  if (opts.spec && specSrc !== undefined) {
    specBlock = `\n\n## Current Playwright spec (\`${opts.spec}\`)\n\n\`\`\`typescript\n${clipForPrompt(specSrc, 80_000)}\n\`\`\`\n`;
  }

  const md = formatHealMarkdown(
    runId,
    goals.map((g) => ({ id: g.id, status: g.status, prompt: g.prompt })),
    issues.map((i) => ({ severity: i.severity, title: i.title, category: i.category, detail: i.detail })),
  )
    .concat(artifactTail)
    .concat(traceDigestBlock)
    .concat(specBlock);

  const r = await suggestHealingMarkdown(llmClientConfig(config.llm), md, {
    specPatchMode: Boolean(opts.spec),
  });
  if (!r.ok) {
    process.stderr.write(chalk.red(JSON.stringify(r.error) + "\n"));
    process.exit(2);
  }
  if (opts.out) {
    await fs.writeFile(path.resolve(opts.cwd, opts.out), r.value, "utf8");
    process.stdout.write(chalk.green(`wrote ${opts.out}\n`));
  } else {
    process.stdout.write(r.value + "\n");
  }

  if (opts.apply) {
    if (specSrc === undefined || specAbs === undefined) {
      process.stderr.write(chalk.red("internal: --apply without spec content\n"));
      process.exit(2);
    }
    const repairEnabled = Boolean(opts.repair) || policy.heal.repairOnApplyFailure;
    const maxRepair = policy.heal.maxRepairAttempts;
    let healMarkdown = r.value;
    let patch = extractUnifiedDiffFromHealMarkdown(healMarkdown);
    if (!patch) {
      process.stderr.write(
        chalk.red(
          "heal output had no ```diff / ```patch block to apply (look for ## Proposed spec edits from the model)\n",
        ),
      );
      process.exit(2);
    }
    let next = tryApplyUnifiedDiff(specSrc, patch);
    let repairsUsed = 0;
    while (next === false && repairEnabled && repairsUsed < maxRepair) {
      repairsUsed++;
      const repairUser = [
        "## Current spec (full file)",
        "",
        "```typescript",
        specSrc,
        "```",
        "",
        "## Failed unified diff (did not apply)",
        "",
        "```diff",
        patch,
        "```",
        "",
        "## Prior model output (for context)",
        "",
        healMarkdown.slice(0, 60_000),
      ].join("\n");
      const rep = await suggestRepairUnifiedDiffMarkdown(llmClientConfig(config.llm), repairUser);
      if (!rep.ok) {
        process.stderr.write(chalk.red(`repair LLM call failed: ${JSON.stringify(rep.error)}\n`));
        break;
      }
      healMarkdown = rep.value;
      process.stdout.write(chalk.yellow(`heal: repair attempt ${repairsUsed}/${maxRepair} (re-parsing diff)\n`));
      const newPatch = extractUnifiedDiffFromHealMarkdown(healMarkdown);
      if (!newPatch) break;
      patch = newPatch;
      next = tryApplyUnifiedDiff(specSrc, patch);
    }
    if (next === false) {
      process.stderr.write(
        chalk.red(
          "patch did not apply cleanly to the spec file (left unchanged). Re-run heal, use --repair, or edit lookout.policy.json heal.*\n",
        ),
      );
      process.exit(1);
    }
    if (opts.dryRun) {
      process.stdout.write(
        chalk.cyan(
          `dry-run: patch applies cleanly (${specSrc.length} → ${next.length} chars). Remove --dry-run (and set LOOKOUT_HEAL_APPLY=1 in CI) to write spec + *.lookout-heal.bak\n`,
        ),
      );
      process.exit(0);
    }
    const bakPath = `${specAbs}.lookout-heal.bak`;
    await fs.writeFile(bakPath, specSrc, "utf8");
    await fs.writeFile(specAbs, next, "utf8");
    process.stdout.write(chalk.green(`applied heal diff → ${specAbs}\nbackup → ${bakPath}\n`));
    if (repairsUsed > 0) {
      process.stdout.write(chalk.yellow(`(used ${repairsUsed} automatic repair pass(es))\n`));
    }
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
  const polRes = await loadPolicyPack(opts.cwd);
  if (!polRes.ok) {
    process.stderr.write(chalk.red(`lookout.policy.json: ${JSON.stringify(polRes.error)}\n`));
    process.exit(2);
  }
  const policy = polRes.value;
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
  const policyBlock =
    policy.verifyRun.appendMarkdown.trim().length > 0
      ? `\n\n## Team policy (lookout.policy.json)\n\n${policy.verifyRun.appendMarkdown.trim()}\n`
      : "";
  const md = [
    "# Lookout run (agent judge input)",
    "",
    "Use the JSON below. Focus on whether major/critical issues represent real regressions vs noise.",
    "",
    "```json",
    JSON.stringify(bundle, null, 2),
    "```",
    policyBlock,
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

  program
    .command("policy")
    .description("Team policy pack (lookout.policy.json): flake exit codes, verify-run rubric, heal repair defaults")
    .argument("<sub>", "show | validate | init")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--force", "with init: overwrite existing lookout.policy.json")
    .action(async (sub: string, o: { cwd?: string; force?: boolean }) =>
      cmdPolicy(sub, { cwd: path.resolve(o.cwd ?? process.cwd()), force: o.force }),
    );

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
    .command("diagnose-flake")
    .description(
      "LLM triage for retry scenarios: compare a failed run vs a later passing run (bundles + step timing skew); exit 1 if verdict is in lookout.policy.json flakeDiagnose.exitNonZeroVerdicts",
    )
    .argument("<failRunId>", "run that failed (e.g. first CI attempt)")
    .argument("<passRunId>", "run that passed (e.g. retry that succeeded)")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--config <file>", "config file path (relative to cwd or absolute)")
    .option(
      "--with-trace-digests",
      "append machine-extracted NDJSON digests from the first trace zip of each run (noisy but high-signal)",
    )
    .option("--json", "structured diagnosis JSON")
    .action(
      async (
        failRunId: string,
        passRunId: string,
        o: { cwd?: string; config?: string; json?: boolean; withTraceDigests?: boolean },
      ) =>
        cmdRunsDiagnoseFlake({
          cwd: path.resolve(o.cwd ?? process.cwd()),
          failRunId,
          passRunId,
          json: Boolean(o.json),
          configFile: o.config,
          withTraceDigests: Boolean(o.withTraceDigests),
        }),
    );

  runs
    .command("parse-flake-stderr")
    .description(
      "Read a file containing `lookout ci` stderr; if a flake_suspected line includes prior_failed_run_id + passed_run_id, print them as: <prior> <pass> (for shell capture in CI)",
    )
    .argument("<file>", "path to captured stderr (e.g. from: lookout ci ... 2> ci-stderr.txt)")
    .action(async (file: string) => cmdRunsParseFlakeStderr({ file }));

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
    .description(
      "LLM-assisted markdown from the latest run's issues; with --spec, ingests Playwright trace NDJSON and requests a unified diff (## Proposed spec edits)",
    )
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--config <file>", "config file path (relative to cwd or absolute)")
    .option("--run <id>", "run id (default: latest)")
    .option(
      "--spec <file>",
      "path to an existing Playwright .spec.ts to heal (relative to cwd); enables trace digest + spec-patch prompt",
    )
    .option(
      "--apply",
      "after heal, apply the first ```diff / ```patch from the model to --spec (writes *.lookout-heal.bak first); requires --spec",
    )
    .option(
      "--dry-run",
      "with --apply: verify the patch applies but do not write files; in CI with CI=true, --apply still requires LOOKOUT_HEAL_APPLY=1",
    )
    .option(
      "--repair",
      "if --apply patch fails, run a repair LLM pass (up to max in lookout.policy.json heal.maxRepairAttempts; or set heal.repairOnApplyFailure there)",
    )
    .option("--out <file>", "write markdown to file instead of stdout")
    .action(
      async (o: {
        cwd?: string;
        config?: string;
        run?: string;
        out?: string;
        spec?: string;
        apply?: boolean;
        dryRun?: boolean;
        repair?: boolean;
      }) =>
        cmdHeal({
          cwd: path.resolve(o.cwd ?? process.cwd()),
          configFile: o.config,
          run: o.run,
          out: o.out,
          spec: o.spec,
          apply: Boolean(o.apply),
          dryRun: Boolean(o.dryRun),
          repair: Boolean(o.repair),
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
