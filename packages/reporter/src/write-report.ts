import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoreWithRoot } from "@lookout/store";
import { buildReport } from "./build-report.js";
import type { ReportData } from "./types.js";

export type WriteReportOpts = {
  store: StoreWithRoot;
  runId: string;
  outPath: string;
  bundle?: boolean;
};

async function shapeReportData(store: StoreWithRoot, runId: string): Promise<ReportData> {
  const run = await store.getRun(runId);
  if (!run) throw new Error("run_not_found");
  const goals = await store.listGoalsForRun(runId);
  const issues = await store.listIssuesForRun(runId);
  const goalsWithSteps = [];
  const pageMap = new Map<string, { visits: number; firstStepId: string }>();
  for (const g of goals) {
    const steps = await store.listStepsForGoal(g.id);
    goalsWithSteps.push({ ...g, steps, issues: [] });
    for (const s of steps) {
      const cur = pageMap.get(s.url);
      if (!cur) pageMap.set(s.url, { visits: 1, firstStepId: s.id });
      else cur.visits++;
    }
  }
  const uxScores = (run.summary?.uxScores ?? {}) as Record<string, import("./types.js").UXScore>;
  const pages = [...pageMap.entries()].map(([url, meta]) => {
    const visual = issues.find((i) => i.category === "visual" && (i.detail as { url?: string }).url === url);
    const detail = visual?.detail as { diffImagePath?: string; diffRatio?: number } | undefined;
    const base = {
      url,
      visits: meta.visits,
      firstStepId: meta.firstStepId,
      a11yScore: null as number | null,
    };
    if (visual) {
      return {
        ...base,
        visualDiff: { url, diffImagePath: detail?.diffImagePath, diffRatio: detail?.diffRatio },
        ...(uxScores[url] ? { uxAudit: uxScores[url] } : {}),
      };
    }
    return {
      ...base,
      ...(uxScores[url] ? { uxAudit: uxScores[url] } : {}),
    };
  });
  return { run, goals: goalsWithSteps, issues, pages };
}

/**
 * Write `report.html` for a completed run.
 */
export async function writeReport(opts: WriteReportOpts): Promise<string> {
  const data = await shapeReportData(opts.store, opts.runId);
  const html = opts.bundle ? buildReport(data) : buildReport(data);
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  await writeFile(opts.outPath, html, "utf8");
  return opts.outPath;
}
