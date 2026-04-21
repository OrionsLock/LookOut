import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createStore, normalizeUrl, readA11ySnapshotFromStore, urlHash } from "./index.js";

const tmp = path.join(process.cwd(), "tmp-store");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmp, { recursive: true, force: true });
});

describe("normalizeUrl + urlHash", () => {
  it("strips query and trailing slash", () => {
    expect(normalizeUrl("https://ex.com/a/?x=1#h")).toBe("https://ex.com/a");
  });

  it("has stable hash", () => {
    expect(urlHash("https://ex.com/a?x=1")).toBe(urlHash("https://ex.com/a"));
  });
});

describe("Store", () => {
  it("roundtrips run goal step issue", async () => {
    const root = path.join(tmp, "r1");
    const store = createStore(root);
    const init = await store.init();
    expect(init.ok).toBe(true);

    const run = await store.createRun({ baseUrl: "http://localhost:3000" });
    const goal = await store.createGoal({ runId: run.id, prompt: "12345678901" });
    await store.updateGoal(goal.id, { status: "running", startedAt: Date.now() });

    const rel = await store.putScreenshot(run.id, "0-after.png", Buffer.from("png"));
    expect(rel).toContain("runs/");
    const step = await store.recordStep({
      goalId: goal.id,
      idx: 0,
      url: "http://localhost:3000/",
      action: { kind: "wait", ms: 0, intent: "x" },
      selectorResolved: null,
      screenshotBefore: null,
      screenshotAfter: rel,
      a11yTreePath: null,
      verdict: "ok",
      durationMs: 1,
    });
    expect(step.id).toBeTruthy();

    const steps = await store.listStepsForGoal(goal.id);
    expect(steps).toHaveLength(1);

    await store.recordIssue({
      runId: run.id,
      stepId: step.id,
      severity: "major",
      category: "console",
      title: "t",
      detail: { x: 1 },
    });
    const issues = await store.listIssuesForRun(run.id);
    expect(issues).toHaveLength(1);

    store.close();
  });

  it("readA11ySnapshotFromStore rejects path traversal", async () => {
    const root = path.join(tmp, "a11y-sec");
    await expect(readA11ySnapshotFromStore(root, "../etc/passwd")).rejects.toThrow(/invalid_path/);
  });

  it("listStepsForGoal tolerates corrupt stored action JSON", async () => {
    const root = path.join(tmp, "corrupt-action");
    const store = createStore(root);
    expect((await store.init()).ok).toBe(true);
    const run = await store.createRun({ baseUrl: "http://localhost:3000" });
    const goal = await store.createGoal({ runId: run.id, prompt: "12345678901" });
    const step = await store.recordStep({
      goalId: goal.id,
      idx: 0,
      url: "http://localhost:3000/",
      action: { kind: "wait", ms: 0, intent: "x" },
      selectorResolved: null,
      screenshotBefore: null,
      screenshotAfter: null,
      a11yTreePath: null,
      verdict: "ok",
      durationMs: 1,
    });
    store.close();
    const dbPath = path.join(root, "runs.db");
    const db = new Database(dbPath);
    db.prepare("UPDATE steps SET action_json = ? WHERE id = ?").run("{not-json", step.id);
    db.close();
    const store2 = createStore(root);
    expect((await store2.init()).ok).toBe(true);
    const steps = await store2.listStepsForGoal(goal.id);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toEqual({ kind: "stuck", reason: "stored_action_invalid" });
    store2.close();
  });

  it("rejects path traversal in putScreenshot", async () => {
    const root = path.join(tmp, "r2");
    const store = createStore(root);
    expect((await store.init()).ok).toBe(true);
    const run = await store.createRun({ baseUrl: "http://localhost:3000" });
    await expect(store.putScreenshot(run.id, "../x.png", Buffer.from("a"))).rejects.toThrow();
    store.close();
  });

  it("baseline roundtrip", async () => {
    const root = path.join(tmp, "r3");
    const store = createStore(root);
    expect((await store.init()).ok).toBe(true);
    const run = await store.createRun({ baseUrl: "http://localhost:3000" });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const b = await store.putBaseline({ url: "http://localhost:3000/a", screenshotBytes: png, runId: run.id });
    const got = await store.getBaseline(b.urlHash);
    expect(got?.url).toBe(normalizeUrl("http://localhost:3000/a"));
    const cleared = await store.clearBaselines();
    expect(cleared).toBe(1);
    store.close();
  });

  it("concurrent writes", async () => {
    const root = path.join(tmp, "r4");
    const store = createStore(root);
    expect((await store.init()).ok).toBe(true);
    const run = await store.createRun({ baseUrl: "http://localhost:3000" });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.putScreenshot(run.id, `f-${i}.png`, Buffer.from(String(i))),
      ),
    );
    store.close();
  });

  it("init fails on corrupt db file", async () => {
    const root = path.join(tmp, "r5");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "runs.db"), "not sqlite");
    const store = createStore(root);
    const init = await store.init();
    expect(init.ok).toBe(false);
    if (!init.ok) expect(init.error.kind).toBe("corrupt_db");
    store.close();
  });

  it("listRuns clamps limit to a sane max", async () => {
    const root = path.join(tmp, "r-limit");
    const store = createStore(root);
    expect((await store.init()).ok).toBe(true);
    // 3 runs to prove we never return more than exist and the clamp
    // doesn't crash with a huge input.
    for (let i = 0; i < 3; i++) await store.createRun({ baseUrl: "http://localhost:3000/" });
    const rows = await store.listRuns({ limit: 1_000_000 });
    expect(rows.length).toBe(3);
    const zero = await store.listRuns({ limit: 0 });
    // 0 gets clamped up to 1
    expect(zero.length).toBe(1);
    store.close();
  });

  it("getScreenshot rejects prefix-matching attacks", async () => {
    const root = path.join(tmp, "r-shot-sec");
    const store = createStore(root);
    expect((await store.init()).ok).toBe(true);
    const run = await store.createRun({ baseUrl: "http://localhost:3000/" });
    const rel = await store.putScreenshot(run.id, "shot.png", Buffer.from("x"));
    const got = await store.getScreenshot(run.id, rel);
    expect(got.toString()).toBe("x");
    // Path traversal is rejected.
    await expect(store.getScreenshot(run.id, "../../etc/passwd")).rejects.toThrow(/invalid_path/);
    // runId with `..` is rejected before hitting the filesystem.
    await expect(store.getScreenshot("../..", rel)).rejects.toThrow(/invalid_path/);
    // A different run id (even if a prefix) cannot read this run's screenshot.
    const other = await store.createRun({ baseUrl: "http://localhost:3000/" });
    await expect(store.getScreenshot(other.id, rel)).rejects.toThrow(/invalid_path/);
    store.close();
  });

  it("recordStep surfaces duplicate_step when (goal_id, idx) collides", async () => {
    const root = path.join(tmp, "r-dup");
    const store = createStore(root);
    expect((await store.init()).ok).toBe(true);
    const run = await store.createRun({ baseUrl: "http://localhost:3000/" });
    const goal = await store.createGoal({ runId: run.id, prompt: "12345678901" });
    const base = {
      goalId: goal.id,
      url: "http://localhost:3000/",
      action: { kind: "wait", ms: 0, intent: "x" } as const,
      selectorResolved: null,
      screenshotBefore: null,
      screenshotAfter: null,
      a11yTreePath: null,
      verdict: "ok" as const,
      durationMs: 1,
    };
    await store.recordStep({ ...base, idx: 0 });
    await expect(store.recordStep({ ...base, idx: 0 })).rejects.toThrow(/duplicate_step/);
    store.close();
  });

  it("runs migrations idempotently", async () => {
    const root = path.join(tmp, "r-mig");
    const s1 = createStore(root);
    expect((await s1.init()).ok).toBe(true);
    s1.close();
    // Re-open — should not throw / re-apply migrations.
    const s2 = createStore(root);
    expect((await s2.init()).ok).toBe(true);
    s2.close();
  });
});
