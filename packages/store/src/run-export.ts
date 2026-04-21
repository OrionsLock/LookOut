import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Goal, Issue, Run, Step } from "@lookout/types";

export type ExportableStore = {
  getRun(id: string): Promise<Run | null>;
  listGoalsForRun(runId: string): Promise<Goal[]>;
  listStepsForGoal(goalId: string): Promise<Step[]>;
  listIssuesForRun(runId: string): Promise<Issue[]>;
};

async function traceZipRelPaths(storeRoot: string, runId: string): Promise<string[]> {
  const dir = path.join(storeRoot, "runs", runId);
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.startsWith("trace") && n.endsWith(".zip"))
      .map((n) => path.join(".lookout", "runs", runId, n).replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

export type GoalStepExport = {
  goalId: string;
  steps: Array<{
    idx: number;
    url: string;
    actionKind: string;
    verdict: string;
    durationMs: number;
    screenshotAfter: string | null;
    a11yTreePath: string | null;
  }>;
};

export type RunExportBundleV2 = {
  version: 2;
  exportedAt: number;
  cwd: string;
  run: Run;
  goals: Goal[];
  goalSteps: GoalStepExport[];
  issues: Issue[];
  artifacts: { reportHtmlRelative: string; traceZips: string[] };
};

/** JSON-serializable run bundle for CI artifacts and MCP (version 2). */
export async function buildRunExportBundle(
  store: ExportableStore,
  storeRoot: string,
  cwd: string,
  runId: string,
): Promise<RunExportBundleV2 | null> {
  const run = await store.getRun(runId);
  if (!run) return null;
  const [goals, issues, traceZips] = await Promise.all([
    store.listGoalsForRun(runId),
    store.listIssuesForRun(runId),
    traceZipRelPaths(storeRoot, runId),
  ]);
  const goalSteps: GoalStepExport[] = [];
  for (const g of goals) {
    const steps = await store.listStepsForGoal(g.id);
    goalSteps.push({
      goalId: g.id,
      steps: steps.map((s) => ({
        idx: s.idx,
        url: s.url,
        actionKind: s.action.kind,
        verdict: s.verdict,
        durationMs: s.durationMs,
        screenshotAfter: s.screenshotAfter,
        a11yTreePath: s.a11yTreePath,
      })),
    });
  }
  const relReport = path.join(".lookout", "runs", runId, "report.html").replace(/\\/g, "/");
  return {
    version: 2,
    exportedAt: Date.now(),
    cwd,
    run,
    goals,
    goalSteps,
    issues,
    artifacts: {
      reportHtmlRelative: relReport,
      traceZips,
    },
  };
}
