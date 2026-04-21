import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { buildReport } from "./build-report.js";
import type { ReportData } from "./types.js";

describe("buildReport", () => {
  it("contains anchors for goals and steps", () => {
    const data: ReportData = {
      run: {
        id: "run1",
        startedAt: 1,
        endedAt: 2,
        baseUrl: "http://localhost:3000",
        commitSha: null,
        verdict: "clean",
        summary: null,
      },
      goals: [
        {
          id: "g1",
          runId: "run1",
          prompt: "do a thing",
          status: "complete",
          stepsTaken: 1,
          startedAt: 1,
          endedAt: 2,
          steps: [
            {
              id: "s1",
              goalId: "g1",
              idx: 0,
              url: "http://localhost:3000/",
              action: { kind: "wait", ms: 0, intent: "x" },
              selectorResolved: null,
              screenshotBefore: null,
              screenshotAfter: "runs/run1/screens/x.png",
              a11yTreePath: null,
              verdict: "ok",
              durationMs: 1,
              createdAt: 1,
            },
          ],
          issues: [],
        },
      ],
      issues: [],
      pages: [],
    };
    const html = buildReport(data);
    const { document } = parseHTML(html) as {
      document: { querySelector: (sel: string) => unknown };
    };
    expect(document.querySelector("#goal-g1")).toBeTruthy();
    expect(document.querySelector("#step-s1")).toBeTruthy();
  });
});
