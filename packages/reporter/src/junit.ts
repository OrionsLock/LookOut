import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoreWithRoot } from "@lookout/store";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Emit a minimal JUnit XML file for CI consumption.
 */
export async function writeJunitXml(opts: { store: StoreWithRoot; runId: string; outPath: string }): Promise<void> {
  const run = await opts.store.getRun(opts.runId);
  if (!run) throw new Error("run_not_found");
  const goals = await opts.store.listGoalsForRun(opts.runId);
  const cases = goals
    .map((g) => {
      const name = esc(g.prompt);
      if (g.status === "complete") {
        return `<testcase classname="lookout.goal" name="${name}" time="0"/>`;
      }
      if (g.status === "pending") {
        return `<testcase classname="lookout.goal" name="${name}" time="0"><skipped/></testcase>`;
      }
      const body = esc(`status=${g.status}`);
      return `<testcase classname="lookout.goal" name="${name}" time="0"><failure message="goal_failed">${body}</failure></testcase>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="lookout" tests="${goals.length}" failures="${goals.filter((g) => g.status === "stuck" || g.status === "error").length}" skipped="${goals.filter((g) => g.status === "pending").length}">
    ${cases}
  </testsuite>
</testsuites>`;
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  await writeFile(opts.outPath, xml, "utf8");
}
