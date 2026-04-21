import path from "node:path";
import type { ResolvedLookoutConfig } from "@lookout/config";
import type { LLMClient } from "@lookout/llm";
import { summarizeA11yTree } from "@lookout/llm";
import { readA11ySnapshotFromStore, urlHash, type StoreWithRoot } from "@lookout/store";
import { visualDiff } from "./visual-diff.js";

export type AnalysisResult = {
  visualRegressions: number;
  uxIssues: number;
  a11yIssues: number;
  errors: Array<{ phase: string; cause: unknown }>;
};

async function listAllStepsForRun(
  store: StoreWithRoot,
  runId: string,
): Promise<
  Array<{
    url: string;
    screenshotAfter: string | null;
    a11yTreePath: string | null;
  }>
> {
  const goals = await store.listGoalsForRun(runId);
  const out: Array<{ url: string; screenshotAfter: string | null; a11yTreePath: string | null }> = [];
  for (const g of goals) {
    const steps = await store.listStepsForGoal(g.id);
    for (const s of steps) {
      out.push({ url: s.url, screenshotAfter: s.screenshotAfter, a11yTreePath: s.a11yTreePath });
    }
  }
  return out;
}

/**
 * Post-run analysis: visual regression + UX audit, persisting issues into the store.
 */
export async function analyzeRun(opts: {
  runId: string;
  store: StoreWithRoot;
  llm?: LLMClient;
  config: ResolvedLookoutConfig;
}): Promise<AnalysisResult> {
  const errors: AnalysisResult["errors"] = [];
  let visualRegressions = 0;
  let uxIssues = 0;
  const a11yIssues = 0;

  const storeRoot = opts.store.rootDir;

  if (opts.config.checks.visualRegression.enabled) {
    const steps = await listAllStepsForRun(opts.store, opts.runId);
    const lastByUrl = new Map<string, { screenshotAfter: string; url: string }>();
    for (const s of steps) {
      if (s.screenshotAfter) lastByUrl.set(s.url, { screenshotAfter: s.screenshotAfter, url: s.url });
    }
    const fs = await import("node:fs/promises");
    for (const { screenshotAfter, url } of lastByUrl.values()) {
      const h = urlHash(url);
      const baseline = await opts.store.getBaseline(h);
      if (!baseline) continue;
      try {
        const baseBuf = await fs.readFile(path.join(storeRoot, baseline.screenshotPath));
        const curBuf = await fs.readFile(path.join(storeRoot, screenshotAfter.replaceAll("\\", "/")));
        const diff = visualDiff(baseBuf, curBuf, opts.config.checks.visualRegression.threshold);
        if (!diff.exceedsThreshold) continue;
        visualRegressions++;
        const overlayName = `diff-${h.slice(0, 8)}.png`;
        const overlayRel = await opts.store.putScreenshot(opts.runId, overlayName, diff.diffPng);
        await opts.store.recordIssue({
          runId: opts.runId,
          stepId: null,
          severity: "major",
          category: "visual",
          title: `Visual regression on ${url}`,
          detail: { diffRatio: diff.diffRatio, diffImagePath: overlayRel, url },
        });
      } catch (e) {
        errors.push({ phase: "visual", cause: e });
      }
    }
  }

  if (opts.llm) {
    const steps = await listAllStepsForRun(opts.store, opts.runId);
    const urls = [...new Set(steps.map((s) => s.url))];
    const summaryByUrl = new Map<string, string>();
    for (const u of urls) {
      const stepWithTree = [...steps].reverse().find((s) => s.url === u && s.a11yTreePath);
      if (!stepWithTree?.a11yTreePath) continue;
      try {
        const snap = await readA11ySnapshotFromStore(storeRoot, stepWithTree.a11yTreePath);
        summaryByUrl.set(u, summarizeA11yTree(snap));
      } catch {
        // ignore
      }
    }
    const shotByUrl = new Map<string, Buffer>();
    const fs = await import("node:fs/promises");
    for (const s of steps) {
      if (!s.screenshotAfter) continue;
      try {
        const buf = await fs.readFile(path.join(storeRoot, s.screenshotAfter.replaceAll("\\", "/")));
        shotByUrl.set(s.url, buf);
      } catch {
        // ignore
      }
    }
    const uxScores: Record<string, unknown> = {};
    for (const u of urls) {
      const summary = summaryByUrl.get(u);
      const png = shotByUrl.get(u);
      if (!summary || !png) continue;
      const scored = await opts.llm.scoreUX({ url: u, a11yTreeSummary: summary, screenshotPng: png });
      if (!scored.ok) {
        errors.push({ phase: "ux", cause: scored.error });
        continue;
      }
      uxScores[u] = scored.value;
      for (const c of scored.value.concerns) {
        uxIssues++;
        const severity =
          c.severity === "serious"
            ? ("major" as const)
            : c.severity === "moderate"
              ? ("minor" as const)
              : ("info" as const);
        await opts.store.recordIssue({
          runId: opts.runId,
          stepId: null,
          severity,
          category: "ux",
          title: c.title,
          detail: { detail: c.detail, url: u },
        });
      }
    }
    const run = await opts.store.getRun(opts.runId);
    if (run) {
      await opts.store.updateRun(opts.runId, {
        summary: { ...(run.summary ?? {}), uxScores },
      });
    }
  }

  return { visualRegressions, uxIssues, a11yIssues, errors };
}
