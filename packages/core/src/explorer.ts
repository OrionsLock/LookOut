import type { Logger } from "pino";
import type { Page } from "playwright";
import type { Action, Goal, Verdict } from "@lookout/types";
import type { LLMClient } from "@lookout/llm";
import type { StoreWithRoot } from "@lookout/store";
import type { ResolvedLookoutConfig } from "@lookout/config";
import {
  createA11yRecorder,
  createConsoleRecorder,
  createNetworkRecorder,
  createPerformanceRecorder,
  createScreenshotRecorder,
} from "@lookout/recorders";
import { resolveTarget } from "./resolver.js";

export type ExplorerOpts = {
  page: Page;
  goal: Goal;
  budget: number;
  llm: LLMClient;
  store: StoreWithRoot;
  checks: ResolvedLookoutConfig["checks"];
  /**
   * The run's `baseUrl`. Used to enforce the navigate origin allowlist so an
   * LLM-planned navigate can't reach a host outside the configured scope
   * unless the config explicitly opts in.
   */
  baseUrl: string;
  logger: Logger;
};

export type ExplorerResult = {
  goalId: string;
  status: "complete" | "stuck" | "error";
  stepsTaken: number;
};

type ActResult = { verdict: Verdict; selector: string | null; error?: unknown };

/**
 * Mini-DSL: `url:substring`, `title:substring`, `text:substring`, or plain substring match on body text.
 */
async function evaluateAssert(page: Page, expectation: string): Promise<ActResult> {
  const t = expectation.trim();
  if (t.startsWith("url:")) {
    const sub = t.slice(4).trim();
    return page.url().includes(sub)
      ? { verdict: "ok", selector: null }
      : {
          verdict: "error",
          selector: null,
          error: new Error(`url does not contain: ${sub}`),
        };
  }
  if (t.startsWith("title:")) {
    const sub = t.slice(6).trim();
    const title = await page.title();
    return title.includes(sub)
      ? { verdict: "ok", selector: null }
      : {
          verdict: "error",
          selector: null,
          error: new Error(`title does not contain: ${sub}`),
        };
  }
  if (t.startsWith("text:")) {
    const sub = t.slice(5).trim();
    const body = await page.locator("body").innerText().catch(() => "");
    return body.includes(sub)
      ? { verdict: "ok", selector: null }
      : {
          verdict: "error",
          selector: null,
          error: new Error(`body text does not contain: ${sub}`),
        };
  }
  const body = await page.locator("body").innerText().catch(() => "");
  return body.includes(t)
    ? { verdict: "ok", selector: null }
    : { verdict: "error", selector: null, error: new Error(`assertion failed: ${t}`) };
}

/**
 * Decide whether a navigate URL is allowed given the navigate-allowlist
 * configuration. Exported for tests.
 */
export function isNavigateAllowed(
  target: URL,
  baseUrl: string,
  allowed: ResolvedLookoutConfig["checks"]["navigate"]["allowedOrigins"],
): boolean {
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;
  if (allowed === "any") return true;
  if (allowed === "same-origin") {
    try {
      return target.origin === new URL(baseUrl).origin;
    } catch {
      return false;
    }
  }
  if (Array.isArray(allowed)) {
    const origins = new Set<string>();
    try {
      origins.add(new URL(baseUrl).origin);
    } catch {
      // ignore
    }
    for (const entry of allowed) {
      try {
        origins.add(new URL(entry).origin);
      } catch {
        // ignore entries that aren't URLs — Zod max(32) already bounds size
      }
    }
    return origins.has(target.origin);
  }
  return false;
}

async function act(
  page: Page,
  action: Action,
  ctx: { baseUrl: string; checks: ResolvedLookoutConfig["checks"] },
): Promise<ActResult> {
  switch (action.kind) {
    case "click": {
      const resolved = await resolveTarget(page, action.target);
      if (!resolved) return { verdict: "resolution-failed", selector: null };
      try {
        await resolved.locator.click({ timeout: 5000 });
        return { verdict: "ok", selector: resolved.serialized };
      } catch (e) {
        return { verdict: "error", selector: resolved.serialized, error: e };
      }
    }
    case "fill": {
      const resolved = await resolveTarget(page, action.target);
      if (!resolved) return { verdict: "resolution-failed", selector: null };
      try {
        await resolved.locator.fill(action.value, { timeout: 5000 });
        return { verdict: "ok", selector: resolved.serialized };
      } catch (e) {
        return { verdict: "error", selector: resolved.serialized, error: e };
      }
    }
    case "select": {
      const resolved = await resolveTarget(page, action.target);
      if (!resolved) return { verdict: "resolution-failed", selector: null };
      try {
        await resolved.locator.selectOption(action.value, { timeout: 5000 });
        return { verdict: "ok", selector: resolved.serialized };
      } catch (e) {
        return { verdict: "error", selector: resolved.serialized, error: e };
      }
    }
    case "navigate": {
      let u: URL;
      try {
        u = new URL(action.url, ctx.baseUrl);
      } catch (e) {
        return { verdict: "error", selector: null, error: e };
      }
      if (!isNavigateAllowed(u, ctx.baseUrl, ctx.checks.navigate.allowedOrigins)) {
        return {
          verdict: "error",
          selector: null,
          error: new Error(
            `navigate blocked: ${u.origin} not in allowedOrigins (baseUrl=${ctx.baseUrl})`,
          ),
        };
      }
      await page.goto(u.toString(), { timeout: 15_000, waitUntil: "domcontentloaded" });
      return { verdict: "ok", selector: null };
    }
    case "wait": {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, action.ms);
      });
      return { verdict: "ok", selector: null };
    }
    case "assert": {
      return evaluateAssert(page, action.expectation);
    }
    case "complete":
    case "stuck":
      return { verdict: "no-op", selector: null };
  }
}

export interface Explorer {
  run(): Promise<ExplorerResult>;
}

export function createExplorer(opts: ExplorerOpts): Explorer {
  const screenshot = createScreenshotRecorder();
  const consoleRec = createConsoleRecorder();
  const netRec = createNetworkRecorder();
  const a11y = createA11yRecorder();
  const perf = createPerformanceRecorder();

  return {
    async run() {
      const { page, goal, budget, llm, store, checks, baseUrl, logger } = opts;
      await screenshot.start(page);
      await consoleRec.start(page);
      await netRec.start(page);
      await a11y.start(page);
      await perf.start(page);

      const stepHistory: Array<{ action: Action; verdict: Verdict }> = [];

      const perceive = async () => {
        const a11yTree = await a11y.snapshotTree(page);
        const screenshotPng = await screenshot.capture();
        return {
          url: page.url(),
          title: await page.title(),
          a11yTree,
          screenshotPng,
        };
      };

      // Guard against a zero or negative budget: the "exceeded step budget"
      // message is misleading when the loop never had a chance to run.
      if (!Number.isFinite(budget) || budget <= 0) {
        await store.recordIssue({
          runId: goal.runId,
          stepId: null,
          severity: "minor",
          category: "flow",
          title: "Goal skipped: budget is zero",
          detail: { goalId: goal.id, budget },
        });
        await store.updateGoal(goal.id, { status: "stuck", endedAt: Date.now(), stepsTaken: 0 });
        await screenshot.stop();
        await consoleRec.stop();
        await netRec.stop();
        await a11y.stop();
        await perf.stop();
        return { goalId: goal.id, status: "stuck", stepsTaken: 0 };
      }

      try {
        for (let idx = 0; idx < budget; idx++) {
          const perception = await perceive();
          const plan = await llm.planAction({ goal: goal.prompt, stepHistory, perception });
          if (!plan.ok) {
            logger.error({ err: plan.error }, "llm_plan_failed");
            await store.recordIssue({
              runId: goal.runId,
              stepId: null,
              severity: "major",
              category: "flow",
              title: "LLM plan failed",
              // plan.error is a discriminated union; JSON.stringify keeps the
              // `kind` and any provider-specific detail for post-mortem.
              detail: { goalId: goal.id, idx, error: JSON.stringify(plan.error) },
            });
            await store.updateGoal(goal.id, { status: "error", endedAt: Date.now(), stepsTaken: idx });
            return { goalId: goal.id, status: "error", stepsTaken: idx };
          }
          const action = plan.value;

          if (action.kind === "complete") {
            await store.updateGoal(goal.id, { status: "complete", endedAt: Date.now(), stepsTaken: idx });
            return { goalId: goal.id, status: "complete", stepsTaken: idx };
          }
          if (action.kind === "stuck") {
            await store.recordIssue({
              runId: goal.runId,
              stepId: null,
              severity: "major",
              category: "flow",
              title: `Goal stuck: ${goal.prompt}`,
              detail: { reason: action.reason, goalId: goal.id },
            });
            await store.updateGoal(goal.id, { status: "stuck", endedAt: Date.now(), stepsTaken: idx });
            return { goalId: goal.id, status: "stuck", stepsTaken: idx };
          }

          const beforeShot = await screenshot.capture();
          const t0 = Date.now();
          const actResult = await act(page, action, { baseUrl, checks });
          const durationMs = Date.now() - t0;
          const afterShot = await screenshot.capture();

          if (action.kind === "navigate" && checks.performance.enabled) {
            await perf.sample(page);
          }

          const a11yPath = await store.putA11yTree(
            goal.runId,
            `${goal.id}-${idx}.json`,
            perception.a11yTree,
          );

          const beforeRel = await store.putScreenshot(goal.runId, `${goal.id}-${idx}-before.png`, beforeShot);
          const afterRel = await store.putScreenshot(goal.runId, `${goal.id}-${idx}-after.png`, afterShot);

          await store.recordStep({
            goalId: goal.id,
            idx,
            url: page.url(),
            action,
            selectorResolved: actResult.selector,
            screenshotBefore: beforeRel,
            screenshotAfter: afterRel,
            a11yTreePath: a11yPath,
            verdict: actResult.verdict,
            durationMs,
          });

          if (actResult.verdict === "error") {
            await store.recordIssue({
              runId: goal.runId,
              stepId: null,
              severity: "major",
              category: "flow",
              title: "Action failed",
              detail: { error: String(actResult.error), goalId: goal.id, idx },
            });
          } else if (actResult.verdict === "resolution-failed") {
            // Silently skipping this meant LLM-planned actions whose target
            // never existed vanished from the issue tab. Surface them so
            // users can diagnose selector / visibility problems.
            await store.recordIssue({
              runId: goal.runId,
              stepId: null,
              severity: "minor",
              category: "flow",
              title: "Target could not be resolved",
              detail: { goalId: goal.id, idx, action },
            });
          }

          const consoleEntries = consoleRec.collect();
          for (const c of consoleEntries) {
            if (!checks.console.failOn.includes(c.level)) continue;
            const sev = c.level === "error" ? "major" : "minor";
            await store.recordIssue({
              runId: goal.runId,
              stepId: null,
              severity: sev,
              category: "console",
              title: `Console ${c.level}`,
              detail: { text: c.text, url: c.url },
            });
          }

          const netEntries = netRec.collect();
          // Compile once per loop; status codes are small, but re-building
          // regex objects per entry gets expensive on chatty pages. Zod
          // already caps length/count, but re-check here defensively.
          const compiled: RegExp[] = [];
          for (const p of checks.network.failOn) {
            if (typeof p !== "string" || p.length > 256) continue;
            try {
              compiled.push(new RegExp(p));
            } catch {
              // invalid regex in config — skip pattern
            }
          }
          for (const n of netEntries) {
            if (!n.status) continue;
            const code = String(n.status);
            let hit = false;
            for (const re of compiled) {
              if (re.test(code)) {
                hit = true;
                break;
              }
            }
            if (!hit) continue;
            const sev = code.startsWith("5") ? "major" : "minor";
            await store.recordIssue({
              runId: goal.runId,
              stepId: null,
              severity: sev,
              category: "network",
              title: `HTTP ${n.status} ${n.url}`,
              detail: { ...n },
            });
          }

          if (checks.a11y.enabled) {
            const violations = await a11y.runOnce(page);
            const order = ["minor", "moderate", "serious", "critical"] as const;
            const failIdx = order.indexOf(checks.a11y.failOn);
            for (const v of violations) {
              const vIdx = order.indexOf(v.impact);
              if (vIdx >= failIdx) {
                const sev =
                  v.impact === "critical"
                    ? "critical"
                    : v.impact === "serious"
                      ? "major"
                      : v.impact === "moderate"
                        ? "minor"
                        : "info";
                await store.recordIssue({
                  runId: goal.runId,
                  stepId: null,
                  severity: sev,
                  category: "a11y",
                  title: v.description,
                  detail: { rule: v.id, helpUrl: v.helpUrl, nodes: v.nodes },
                });
              }
            }
          }

          stepHistory.push({ action, verdict: actResult.verdict });
          await store.updateGoal(goal.id, { stepsTaken: idx + 1 });
        }

        await store.recordIssue({
          runId: goal.runId,
          stepId: null,
          severity: "major",
          category: "flow",
          title: "Goal exceeded step budget",
          detail: { goalId: goal.id },
        });
        await store.updateGoal(goal.id, { status: "stuck", endedAt: Date.now(), stepsTaken: budget });
        return { goalId: goal.id, status: "stuck", stepsTaken: budget };
      } finally {
        await screenshot.stop();
        await consoleRec.stop();
        await netRec.stop();
        await a11y.stop();
        await perf.stop();
      }
    },
  };
}
