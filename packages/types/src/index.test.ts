import { describe, expect, it } from "vitest";
import { ActionSchema, IssueSchema, RunSchema, TargetRefSchema } from "./index.js";

describe("TargetRefSchema", () => {
  it("accepts valid", () => {
    expect(
      TargetRefSchema.parse({ description: 'button "Go"' }),
    ).toMatchObject({ description: 'button "Go"' });
  });

  it("rejects empty description", () => {
    expect(() => TargetRefSchema.parse({ description: "" })).toThrow();
  });
});

describe("ActionSchema", () => {
  it("parses click", () => {
    const a = ActionSchema.parse({
      kind: "click",
      target: { description: 'button "x"' },
      intent: "open",
    });
    expect(a.kind).toBe("click");
  });

  it("rejects invalid kind", () => {
    expect(() =>
      ActionSchema.parse({
        kind: "nope",
        target: { description: "x" },
      }),
    ).toThrow();
  });
});

describe("IssueSchema", () => {
  it("roundtrips", () => {
    const i = {
      id: "01",
      runId: "02",
      stepId: null,
      severity: "major" as const,
      category: "console" as const,
      title: "t",
      detail: { x: 1 },
      createdAt: 1,
    };
    expect(IssueSchema.parse(i)).toEqual(i);
  });
});

describe("RunSchema", () => {
  it("requires url baseUrl", () => {
    expect(() =>
      RunSchema.parse({
        id: "1",
        startedAt: 1,
        endedAt: null,
        baseUrl: "not-a-url",
        commitSha: null,
        verdict: "running",
        summary: null,
      }),
    ).toThrow();
  });
});
