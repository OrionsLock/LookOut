import { describe, expect, it } from "vitest";
import type { Issue } from "@lookout/types";
import { diffIssuesByFingerprint, issueFingerprint } from "./issue-diff.js";

function issue(
  partial: Pick<Issue, "severity" | "category" | "title"> & Partial<Omit<Issue, "severity" | "category" | "title">>,
): Issue {
  return {
    id: partial.id ?? "i1",
    runId: partial.runId ?? "r1",
    stepId: partial.stepId ?? null,
    severity: partial.severity,
    category: partial.category,
    title: partial.title,
    detail: partial.detail ?? {},
    createdAt: partial.createdAt ?? 0,
  };
}

describe("issueFingerprint", () => {
  it("joins severity category title", () => {
    const fp = issueFingerprint(
      issue({ severity: "major", category: "a11y", title: "Missing label", id: "a" }),
    );
    expect(fp).toBe("major\ta11y\tMissing label");
  });
});

describe("diffIssuesByFingerprint", () => {
  it("classifies only-in-each and both", () => {
    const a = issue({ id: "1", severity: "major", category: "flow", title: "A-only" });
    const b = issue({ id: "2", severity: "minor", category: "console", title: "B-only" });
    const shared1 = issue({ id: "3", severity: "info", category: "ux", title: "Same" });
    const shared2 = issue({ id: "4", severity: "info", category: "ux", title: "Same" });
    const d = diffIssuesByFingerprint([a, shared1, shared2], [b, shared1]);
    expect(d.onlyInA.map((i) => i.title)).toEqual(["A-only"]);
    expect(d.onlyInB.map((i) => i.title)).toEqual(["B-only"]);
    expect(d.inBoth).toHaveLength(1);
    expect(d.inBoth[0]?.title).toBe("Same");
  });
});
