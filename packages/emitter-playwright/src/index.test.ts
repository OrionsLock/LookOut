import { describe, expect, it } from "vitest";
import { emitSpec } from "./index.js";

describe("emitSpec", () => {
  it("emits a click + navigate + assert spec", async () => {
    const src = await emitSpec({
      goal: {
        id: "g1",
        runId: "r1",
        prompt: "open the search box and submit",
        status: "complete",
        stepsTaken: 3,
        startedAt: 1,
        endedAt: 2,
      },
      steps: [
        {
          id: "s0",
          goalId: "g1",
          idx: 0,
          url: "http://localhost:3000/",
          action: { kind: "navigate", url: "http://localhost:3000/search", intent: "go" },
          selectorResolved: null,
          screenshotBefore: null,
          screenshotAfter: null,
          a11yTreePath: null,
          verdict: "ok",
          durationMs: 10,
          createdAt: 1,
        },
        {
          id: "s1",
          goalId: "g1",
          idx: 1,
          url: "http://localhost:3000/search",
          action: { kind: "click", target: { role: "button", name: "Submit" }, intent: "click" },
          selectorResolved: `page.getByRole("button", { name: "Submit" })`,
          screenshotBefore: null,
          screenshotAfter: null,
          a11yTreePath: null,
          verdict: "ok",
          durationMs: 5,
          createdAt: 2,
        },
        {
          id: "s2",
          goalId: "g1",
          idx: 2,
          url: "http://localhost:3000/search",
          action: { kind: "assert", expectation: "/search" },
          selectorResolved: null,
          screenshotBefore: null,
          screenshotAfter: null,
          a11yTreePath: null,
          verdict: "ok",
          durationMs: 1,
          createdAt: 3,
        },
      ],
      auth: { type: "none" },
      runMeta: { runId: "r1", lookoutVersion: "test", generatedAt: "2024-01-01T00:00:00Z" },
    });
    expect(src).toContain(`await page.goto("http://localhost:3000/search")`);
    expect(src).toContain(`.click()`);
    expect(src).toContain(`toHaveURL`);
  });

  it("skips fill on a non-fillable role instead of emitting a broken selector", async () => {
    const src = await emitSpec({
      goal: {
        id: "g1",
        runId: "r1",
        prompt: "paste the name into the search button (LLM got it wrong)",
        status: "complete",
        stepsTaken: 1,
        startedAt: 1,
        endedAt: 2,
      },
      steps: [
        {
          id: "s1",
          goalId: "g1",
          idx: 0,
          url: "http://localhost:3000/",
          action: {
            kind: "fill",
            target: { role: "button", name: "Search" },
            value: "hello",
            intent: "type",
          },
          selectorResolved: `page.getByRole("button", { name: "Search" })`,
          screenshotBefore: null,
          screenshotAfter: null,
          a11yTreePath: null,
          verdict: "ok",
          durationMs: 1,
          createdAt: 1,
        },
      ],
      auth: { type: "none" },
      runMeta: { runId: "r1", lookoutVersion: "test", generatedAt: "2024-01-01T00:00:00Z" },
    });
    // The step must not emit a `.fill(` call against a button role — that
    // spec would fail as soon as it runs.
    expect(src).not.toMatch(/getByRole\("button".*\.fill\(/);
    expect(src).toMatch(/not a fillable role/);
  });

  it("allows fill on textbox/searchbox/combobox/spinbutton", async () => {
    for (const role of ["textbox", "searchbox", "combobox", "spinbutton"] as const) {
      const src = await emitSpec({
        goal: {
          id: `g-${role}`,
          runId: "r1",
          prompt: `fill the ${role}`,
          status: "complete",
          stepsTaken: 1,
          startedAt: 1,
          endedAt: 2,
        },
        steps: [
          {
            id: "s1",
            goalId: `g-${role}`,
            idx: 0,
            url: "http://localhost:3000/",
            action: { kind: "fill", target: { role, name: "x" }, value: "hi", intent: "t" },
            selectorResolved: `page.getByRole(${JSON.stringify(role)}, { name: "x" })`,
            screenshotBefore: null,
            screenshotAfter: null,
            a11yTreePath: null,
            verdict: "ok",
            durationMs: 1,
            createdAt: 1,
          },
        ],
        auth: { type: "none" },
        runMeta: { runId: "r1", lookoutVersion: "test", generatedAt: "2024-01-01T00:00:00Z" },
      });
      expect(src).toMatch(/\.fill\("hi"\)/);
    }
  });
});
