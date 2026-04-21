import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from "playwright";
import { analyzeRun } from "@lookout/analyzers";
import type { ResolvedLookoutConfig } from "@lookout/config";
import type { LLMClient } from "@lookout/llm";
import type { StoreWithRoot } from "@lookout/store";
import type { Goal, RunVerdict, Severity } from "@lookout/types";
import { err, ok, type Result } from "@lookout/types";
import { createExplorer, type ExplorerResult } from "./explorer.js";
import { recordExplorationIssues } from "./exploration.js";
import { createLogger } from "./logger.js";
import { runPool } from "./pool.js";

export type OrchestratorOpts = {
  config: ResolvedLookoutConfig;
  store: StoreWithRoot;
  llm: LLMClient;
  logger?: Logger;
  headed?: boolean;
  /** Optional LLM counters (mutated by a CLI-side wrapper around {@link createClient}). */
  telemetry?: {
    inputTokens: number;
    outputTokens: number;
    planCalls: number;
    scoreCalls: number;
  };
};

export interface Orchestrator {
  run(): Promise<Result<RunResult, OrchestratorError>>;
}

export type RunResult = {
  runId: string;
  verdict: RunVerdict;
  summary: {
    goalsAttempted: number;
    goalsComplete: number;
    goalsStuck: number;
    stepsTotal: number;
    issuesBySeverity: Record<Severity, number>;
  };
};

export type OrchestratorError =
  | { kind: "browser_launch"; cause: unknown }
  | { kind: "auth_failed"; detail: string }
  | { kind: "config_invalid"; detail: string };

function tryGitSha(): string | undefined {
  // CI systems already expose the commit in the environment — trust those
  // before spawning git, which may not be on PATH and can add perceptible
  // latency on cold starts (especially Windows).
  const envSha =
    process.env["GITHUB_SHA"] ??
    process.env["CI_COMMIT_SHA"] ??
    process.env["BUILDKITE_COMMIT"] ??
    process.env["BUILD_SOURCEVERSION"] ??
    null;
  if (envSha && /^[0-9a-f]{7,64}$/i.test(envSha.trim())) {
    return envSha.trim();
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function performCredentialsAuth(
  context: BrowserContext,
  config: ResolvedLookoutConfig,
  logger: Logger,
): Promise<Result<void, OrchestratorError>> {
  if (config.auth.type !== "credentials") return ok(undefined);
  const auth = config.auth;
  const page = await context.newPage();
  let resolvedLoginUrl: URL;
  try {
    resolvedLoginUrl = new URL(auth.loginUrl, config.baseUrl);
  } catch {
    await page.close();
    return err({ kind: "auth_failed", detail: `invalid loginUrl: ${auth.loginUrl}` });
  }
  if (resolvedLoginUrl.protocol !== "http:" && resolvedLoginUrl.protocol !== "https:") {
    await page.close();
    return err({
      kind: "auth_failed",
      detail: `loginUrl protocol not allowed: ${resolvedLoginUrl.protocol}`,
    });
  }
  // Credentials must never be posted to a host other than baseUrl — stop
  // a misconfigured absolute loginUrl from leaking passwords cross-origin.
  const baseOrigin = new URL(config.baseUrl).origin;
  if (resolvedLoginUrl.origin !== baseOrigin) {
    await page.close();
    return err({
      kind: "auth_failed",
      detail: `loginUrl origin (${resolvedLoginUrl.origin}) does not match baseUrl (${baseOrigin})`,
    });
  }
  const loginUrl = resolvedLoginUrl.toString();
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.locator(auth.usernameSelector).fill(auth.username);
    await page.locator(auth.passwordSelector).fill(auth.password);
    await Promise.all([
      page.waitForNavigation({ timeout: 15_000 }).catch(() => null),
      page.locator(auth.submitSelector).click(),
    ]);
    const url = page.url();
    if (auth.successUrlPattern) {
      const re = new RegExp(auth.successUrlPattern);
      if (!re.test(url)) {
        await page.close();
        return err({ kind: "auth_failed", detail: `URL did not match success pattern: ${url}` });
      }
    }
    logger.info({ url }, "auth_ok");
    await page.close();
    return ok(undefined);
  } catch (e) {
    await page.close();
    return err({ kind: "auth_failed", detail: e instanceof Error ? e.message : String(e) });
  }
}

async function saveStorageState(context: BrowserContext, file: string) {
  await context.storageState({ path: file });
}

function countIssues(issues: Array<{ severity: Severity }>): Record<Severity, number> {
  const base: Record<Severity, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const i of issues) base[i.severity]++;
  return base;
}

async function computeVerdict(store: StoreWithRoot, runId: string): Promise<RunVerdict> {
  const goals = await store.listGoalsForRun(runId);
  if (goals.some((g) => g.status === "error")) return "errors";
  const issues = await store.listIssuesForRun(runId);
  if (issues.some((i) => i.severity === "critical" || i.severity === "major")) return "regressions";
  if (goals.some((g) => g.status === "stuck")) return "regressions";
  return "clean";
}

async function countSteps(store: StoreWithRoot, runId: string): Promise<number> {
  const goals = await store.listGoalsForRun(runId);
  let n = 0;
  for (const g of goals) {
    n += (await store.listStepsForGoal(g.id)).length;
  }
  return n;
}

export function createOrchestrator(opts: OrchestratorOpts): Orchestrator {
  const logger = opts.logger;
  return {
    async run() {
      const { config, store, llm, telemetry } = opts;
      const log = logger ?? createLogger("orchestrator", { json: !process.stdout.isTTY });

      const init = await store.init();
      if (!init.ok) return err({ kind: "config_invalid", detail: init.error.message });

      const sha = tryGitSha();
      const runInput: import("@lookout/store").CreateRunInput = { baseUrl: config.baseUrl };
      if (sha) runInput.commitSha = sha;
      const run = await store.createRun(runInput);

      let browser: Browser | null = null;
      try {
        try {
          browser = await chromium.launch({ headless: !opts.headed });
        } catch (e) {
          return err({ kind: "browser_launch", cause: e });
        }

        const viewport = config.crawl.viewport;
        const authStatePath = path.join(store.rootDir, "auth", "storage.json");
        let storageStateFile: string | undefined;
        if (config.auth.type === "storageState") {
          storageStateFile = config.auth.path;
        } else if (config.auth.type === "credentials") {
          await mkdir(path.dirname(authStatePath), { recursive: true });
          const bootstrap = await browser.newContext({ viewport });
          const authRes = await performCredentialsAuth(bootstrap, config, log);
          if (!authRes.ok) {
            await bootstrap.close();
            return err(authRes.error);
          }
          await saveStorageState(bootstrap, authStatePath);
          await bootstrap.close();
          storageStateFile = authStatePath;
        }

        const goalsInConfig = config.crawl.goals;
        for (const g of goalsInConfig) {
          await store.createGoal({ runId: run.id, prompt: g.prompt, id: `${run.id}_${g.id}` });
        }

        const dbGoals = await store.listGoalsForRun(run.id);
        const orderedGoals = goalsInConfig
          .map((c) => dbGoals.find((g) => g.id === `${run.id}_${c.id}`))
          .filter((g): g is Goal => !!g);
        if (orderedGoals.length !== goalsInConfig.length) {
          log.warn(
            { configured: goalsInConfig.length, resolved: orderedGoals.length, runId: run.id },
            "goals_resolution_mismatch",
          );
        }
        const concurrency = config.crawl.maxParallelAgents;

        const traceOn = config.report.traceOnFailure;

        // The explorer is the single owner of goal status/endedAt: it writes
        // the final status (complete/stuck/error) as soon as it knows. The
        // orchestrator only seeds `running`/`startedAt` and catches thrown
        // errors so one goal can't abort the whole run.
        const runSingleGoal = async (goal: Goal): Promise<ExplorerResult> => {
          if (!browser) throw new Error("orchestrator: browser not initialized");
          await store.updateGoal(goal.id, { status: "running", startedAt: Date.now() });
          const ctxOpts: BrowserContextOptions = { viewport };
          if (storageStateFile) ctxOpts.storageState = storageStateFile;
          const context = await browser.newContext(ctxOpts);
          if (traceOn) await context.tracing.start({ screenshots: true, snapshots: true });
          let res: ExplorerResult | undefined;
          try {
            const page = await context.newPage();
            await page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
            const explorer = createExplorer({
              page,
              goal,
              budget: config.crawl.maxStepsPerGoal,
              llm,
              store,
              checks: config.checks,
              baseUrl: config.baseUrl,
              logger: log.child({ goalId: goal.id, component: "explorer" }),
            });
            res = await explorer.run();
            await page.close();
          } catch (e) {
            log.error({ err: e, goalId: goal.id }, "goal_crashed");
            await store.updateGoal(goal.id, {
              status: "error",
              endedAt: Date.now(),
            });
            await store.recordIssue({
              runId: run.id,
              stepId: null,
              severity: "major",
              category: "flow",
              title: "Goal crashed",
              detail: { goalId: goal.id, error: e instanceof Error ? e.message : String(e) },
            });
            res = { goalId: goal.id, status: "error", stepsTaken: 0 };
          } finally {
            if (traceOn) {
              const dir = path.join(store.rootDir, "runs", run.id);
              await mkdir(dir, { recursive: true });
              const zip = path.join(dir, `trace-${goal.id}.zip`);
              if (res && res.status !== "complete") await context.tracing.stop({ path: zip });
              else await context.tracing.stop();
            }
            await context.close();
          }
          return res;
        };

        if (concurrency <= 1) {
          const seqCtx: BrowserContextOptions = { viewport };
          if (storageStateFile) seqCtx.storageState = storageStateFile;
          const context = await browser.newContext(seqCtx);
          if (traceOn) await context.tracing.start({ screenshots: true, snapshots: true });
          let anyGoalBad = false;
          try {
            for (const goal of orderedGoals) {
              await store.updateGoal(goal.id, { status: "running", startedAt: Date.now() });
              let res: ExplorerResult | undefined;
              const page = await context.newPage();
              try {
                await page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
                const explorer = createExplorer({
                  page,
                  goal,
                  budget: config.crawl.maxStepsPerGoal,
                  llm,
                  store,
                  checks: config.checks,
                  baseUrl: config.baseUrl,
                  logger: log.child({ goalId: goal.id }),
                });
                res = await explorer.run();
              } catch (e) {
                log.error({ err: e, goalId: goal.id }, "goal_crashed");
                await store.updateGoal(goal.id, { status: "error", endedAt: Date.now() });
                await store.recordIssue({
                  runId: run.id,
                  stepId: null,
                  severity: "major",
                  category: "flow",
                  title: "Goal crashed",
                  detail: { goalId: goal.id, error: e instanceof Error ? e.message : String(e) },
                });
                res = { goalId: goal.id, status: "error", stepsTaken: 0 };
              } finally {
                await page.close().catch(() => undefined);
              }
              if (res.status !== "complete") anyGoalBad = true;
            }
          } finally {
            if (traceOn) {
              const dir = path.join(store.rootDir, "runs", run.id);
              await mkdir(dir, { recursive: true });
              const zip = path.join(dir, "trace.zip");
              if (anyGoalBad) await context.tracing.stop({ path: zip });
              else await context.tracing.stop();
            }
            await context.close();
          }
        } else {
          await runPool(orderedGoals, concurrency, runSingleGoal);
        }

        if (config.crawl.exploration?.enabled) {
          const exCtx: BrowserContextOptions = { viewport };
          if (storageStateFile) exCtx.storageState = storageStateFile;
          const exContext = await browser.newContext(exCtx);
          const exPage = await exContext.newPage();
          try {
            await recordExplorationIssues(
              exPage,
              store,
              run.id,
              config.baseUrl,
              config.crawl.exploration.budget,
            );
          } finally {
            await exPage.close();
            await exContext.close();
          }
        }

        await analyzeRun({ runId: run.id, store, llm, config }).catch((e) => {
          log.error({ e }, "analyze_run_failed");
        });

        const issues = await store.listIssuesForRun(run.id);
        const verdict = await computeVerdict(store, run.id);
        const goalsFinal = await store.listGoalsForRun(run.id);
        const summary = {
          goalsAttempted: goalsFinal.length,
          goalsComplete: goalsFinal.filter((g) => g.status === "complete").length,
          goalsStuck: goalsFinal.filter((g) => g.status === "stuck").length,
          stepsTotal: await countSteps(store, run.id),
          issuesBySeverity: countIssues(issues),
          ...(telemetry
            ? {
                llmUsage: {
                  inputTokens: telemetry.inputTokens,
                  outputTokens: telemetry.outputTokens,
                  planCalls: telemetry.planCalls,
                  scoreCalls: telemetry.scoreCalls,
                },
              }
            : {}),
        };
        await store.updateRun(run.id, { endedAt: Date.now(), verdict, summary });

        return ok({ runId: run.id, verdict, summary });
      } finally {
        await browser?.close();
      }
    },
  };
}
