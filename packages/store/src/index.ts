import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import type { A11ySnapshot, Goal, Issue, Run, Step } from "@lookout/types";
import { err, ok, type Result } from "@lookout/types";

export type Baseline = {
  urlHash: string;
  url: string;
  screenshotPath: string;
  runId: string;
  createdAt: number;
};

export type CreateRunInput = {
  baseUrl: string;
  commitSha?: string;
};

export type UpdateRunPatch = Partial<Pick<Run, "endedAt" | "verdict" | "summary">>;

export type CreateGoalInput = {
  runId: string;
  prompt: string;
  /** When provided, used as the goal primary key (e.g. config goal id). */
  id?: string;
};

export type UpdateGoalPatch = Partial<Pick<Goal, "status" | "stepsTaken" | "startedAt" | "endedAt">>;

export type RecordStepInput = Omit<Step, "id" | "createdAt">;

export type RecordIssueInput = Omit<Issue, "id" | "createdAt">;

export type PutBaselineInput = {
  url: string;
  screenshotBytes: Buffer;
  runId: string;
};

export type StoreInitError = { kind: "corrupt_db"; message: string };

export type StoreWithRoot = Store & { readonly rootDir: string };

export interface Store {
  init(): Promise<Result<void, StoreInitError>>;
  createRun(input: CreateRunInput): Promise<Run>;
  updateRun(id: string, patch: UpdateRunPatch): Promise<Run>;
  getRun(id: string): Promise<Run | null>;
  listRuns(opts?: { limit?: number }): Promise<Run[]>;

  createGoal(input: CreateGoalInput): Promise<Goal>;
  updateGoal(id: string, patch: UpdateGoalPatch): Promise<Goal>;
  listGoalsForRun(runId: string): Promise<Goal[]>;

  recordStep(input: RecordStepInput): Promise<Step>;
  listStepsForGoal(goalId: string): Promise<Step[]>;

  recordIssue(input: RecordIssueInput): Promise<Issue>;
  listIssuesForRun(runId: string): Promise<Issue[]>;

  putScreenshot(runId: string, name: string, bytes: Buffer): Promise<string>;
  getScreenshot(runId: string, relPath: string): Promise<Buffer>;

  putA11yTree(runId: string, name: string, snapshot: A11ySnapshot): Promise<string>;

  getBaseline(urlHash: string): Promise<Baseline | null>;
  putBaseline(input: PutBaselineInput): Promise<Baseline>;
  clearBaselines(): Promise<number>;

  close(): void;
}

function assertSafeRelativeName(name: string): void {
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("invalid_path: path traversal rejected");
  }
  if (name.trim() === "") {
    throw new Error("invalid_path: empty name");
  }
}

export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  let p = u.pathname;
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  u.pathname = p || "/";
  return u.toString();
}

export function urlHash(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex");
}

class SqliteStore implements Store {
  private db: Database.Database | null = null;

  constructor(private readonly rootDir: string) {}

  async init(): Promise<Result<void, StoreInitError>> {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(path.join(this.rootDir, "runs"), { recursive: true });
    await mkdir(path.join(this.rootDir, "baseline"), { recursive: true });

    const dbPath = path.join(this.rootDir, "runs.db");
    try {
      this.db = new Database(dbPath, { timeout: 5000 });
    } catch (e) {
      return err({
        kind: "corrupt_db",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    try {
      this.db.pragma("journal_mode = WAL");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          base_url TEXT NOT NULL,
          commit_sha TEXT,
          verdict TEXT NOT NULL,
          summary_json TEXT
        );
        CREATE TABLE IF NOT EXISTS goals (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id),
          prompt TEXT NOT NULL,
          status TEXT NOT NULL,
          steps_taken INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER,
          ended_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS steps (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL REFERENCES goals(id),
          idx INTEGER NOT NULL,
          url TEXT NOT NULL,
          action_json TEXT NOT NULL,
          selector_resolved TEXT,
          screenshot_before TEXT,
          screenshot_after TEXT,
          a11y_tree_path TEXT,
          verdict TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id),
          step_id TEXT,
          severity TEXT NOT NULL,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          detail_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS baselines (
          url_hash TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          screenshot_path TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id),
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_steps_goal ON steps(goal_id, idx);
        CREATE INDEX IF NOT EXISTS idx_issues_run ON issues(run_id, severity);
        CREATE INDEX IF NOT EXISTS idx_goals_run ON goals(run_id);
      `);
    } catch (e) {
      this.db.close();
      this.db = null;
      return err({
        kind: "corrupt_db",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return ok(undefined);
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("store_not_initialized");
    return this.db;
  }

  async createRun(input: CreateRunInput): Promise<Run> {
    const db = this.requireDb();
    const id = ulid();
    const startedAt = Date.now();
    db.prepare(
      `INSERT INTO runs (id, started_at, ended_at, base_url, commit_sha, verdict, summary_json)
       VALUES (?, ?, NULL, ?, ?, 'running', NULL)`,
    ).run(id, startedAt, input.baseUrl, input.commitSha ?? null);
    return {
      id,
      startedAt,
      endedAt: null,
      baseUrl: input.baseUrl,
      commitSha: input.commitSha ?? null,
      verdict: "running",
      summary: null,
    };
  }

  async updateRun(id: string, patch: UpdateRunPatch): Promise<Run> {
    const db = this.requireDb();
    const existing = await this.getRun(id);
    if (!existing) throw new Error("run_not_found");
    const endedAt = patch.endedAt ?? existing.endedAt;
    const verdict = patch.verdict ?? existing.verdict;
    const summary = patch.summary !== undefined ? patch.summary : existing.summary;
    db.prepare(
      `UPDATE runs SET ended_at = ?, verdict = ?, summary_json = ? WHERE id = ?`,
    ).run(endedAt, verdict, summary ? JSON.stringify(summary) : null, id);
    const updated = await this.getRun(id);
    if (!updated) throw new Error("run_not_found");
    return updated;
  }

  async getRun(id: string): Promise<Run | null> {
    const db = this.requireDb();
    const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
      | {
          id: string;
          started_at: number;
          ended_at: number | null;
          base_url: string;
          commit_sha: string | null;
          verdict: string;
          summary_json: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      baseUrl: row.base_url,
      commitSha: row.commit_sha,
      verdict: row.verdict as Run["verdict"],
      summary: row.summary_json ? (JSON.parse(row.summary_json) as Record<string, unknown>) : null,
    };
  }

  async listRuns(opts?: { limit?: number }): Promise<Run[]> {
    const db = this.requireDb();
    const limit = opts?.limit ?? 50;
    const rows = db
      .prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as Array<{
      id: string;
      started_at: number;
      ended_at: number | null;
      base_url: string;
      commit_sha: string | null;
      verdict: string;
      summary_json: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      baseUrl: row.base_url,
      commitSha: row.commit_sha,
      verdict: row.verdict as Run["verdict"],
      summary: row.summary_json ? (JSON.parse(row.summary_json) as Record<string, unknown>) : null,
    }));
  }

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const db = this.requireDb();
    const id = input.id ?? ulid();
    db.prepare(
      `INSERT INTO goals (id, run_id, prompt, status, steps_taken, started_at, ended_at)
       VALUES (?, ?, ?, 'pending', 0, NULL, NULL)`,
    ).run(id, input.runId, input.prompt);
    return {
      id,
      runId: input.runId,
      prompt: input.prompt,
      status: "pending",
      stepsTaken: 0,
      startedAt: null,
      endedAt: null,
    };
  }

  async updateGoal(id: string, patch: UpdateGoalPatch): Promise<Goal> {
    const db = this.requireDb();
    const g = db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id) as
      | {
          id: string;
          run_id: string;
          prompt: string;
          status: string;
          steps_taken: number;
          started_at: number | null;
          ended_at: number | null;
        }
      | undefined;
    if (!g) throw new Error("goal_not_found");
    const status = patch.status ?? (g.status as Goal["status"]);
    const stepsTaken = patch.stepsTaken ?? g.steps_taken;
    const startedAt = patch.startedAt !== undefined ? patch.startedAt : g.started_at;
    const endedAt = patch.endedAt !== undefined ? patch.endedAt : g.ended_at;
    db.prepare(
      `UPDATE goals SET status = ?, steps_taken = ?, started_at = ?, ended_at = ? WHERE id = ?`,
    ).run(status, stepsTaken, startedAt, endedAt, id);
    const updatedG = await this.getGoal(id);
    if (!updatedG) throw new Error("goal_not_found");
    return updatedG;
  }

  private async getGoal(id: string): Promise<Goal | null> {
    const db = this.requireDb();
    const g = db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id) as
      | {
          id: string;
          run_id: string;
          prompt: string;
          status: string;
          steps_taken: number;
          started_at: number | null;
          ended_at: number | null;
        }
      | undefined;
    if (!g) return null;
    return {
      id: g.id,
      runId: g.run_id,
      prompt: g.prompt,
      status: g.status as Goal["status"],
      stepsTaken: g.steps_taken,
      startedAt: g.started_at,
      endedAt: g.ended_at,
    };
  }

  async listGoalsForRun(runId: string): Promise<Goal[]> {
    const db = this.requireDb();
    const rows = db
      .prepare(`SELECT * FROM goals WHERE run_id = ? ORDER BY id ASC`)
      .all(runId) as Array<{
      id: string;
      run_id: string;
      prompt: string;
      status: string;
      steps_taken: number;
      started_at: number | null;
      ended_at: number | null;
    }>;
    return rows.map((g) => ({
      id: g.id,
      runId: g.run_id,
      prompt: g.prompt,
      status: g.status as Goal["status"],
      stepsTaken: g.steps_taken,
      startedAt: g.started_at,
      endedAt: g.ended_at,
    }));
  }

  async recordStep(input: RecordStepInput): Promise<Step> {
    const db = this.requireDb();
    const id = ulid();
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO steps (id, goal_id, idx, url, action_json, selector_resolved, screenshot_before, screenshot_after, a11y_tree_path, verdict, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.goalId,
      input.idx,
      input.url,
      JSON.stringify(input.action),
      input.selectorResolved,
      input.screenshotBefore,
      input.screenshotAfter,
      input.a11yTreePath,
      input.verdict,
      input.durationMs,
      createdAt,
    );
    return { ...input, id, createdAt };
  }

  async listStepsForGoal(goalId: string): Promise<Step[]> {
    const db = this.requireDb();
    const rows = db.prepare(`SELECT * FROM steps WHERE goal_id = ? ORDER BY idx ASC`).all(goalId) as Array<{
      id: string;
      goal_id: string;
      idx: number;
      url: string;
      action_json: string;
      selector_resolved: string | null;
      screenshot_before: string | null;
      screenshot_after: string | null;
      a11y_tree_path: string | null;
      verdict: string;
      duration_ms: number;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      goalId: r.goal_id,
      idx: r.idx,
      url: r.url,
      action: JSON.parse(r.action_json) as Step["action"],
      selectorResolved: r.selector_resolved,
      screenshotBefore: r.screenshot_before,
      screenshotAfter: r.screenshot_after,
      a11yTreePath: r.a11y_tree_path,
      verdict: r.verdict as Step["verdict"],
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }));
  }

  async recordIssue(input: RecordIssueInput): Promise<Issue> {
    const db = this.requireDb();
    const id = ulid();
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO issues (id, run_id, step_id, severity, category, title, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.runId,
      input.stepId,
      input.severity,
      input.category,
      input.title,
      JSON.stringify(input.detail),
      createdAt,
    );
    return { ...input, id, createdAt };
  }

  async listIssuesForRun(runId: string): Promise<Issue[]> {
    const db = this.requireDb();
    const rows = db.prepare(`SELECT * FROM issues WHERE run_id = ? ORDER BY created_at ASC`).all(runId) as Array<{
      id: string;
      run_id: string;
      step_id: string | null;
      severity: string;
      category: string;
      title: string;
      detail_json: string;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      stepId: r.step_id,
      severity: r.severity as Issue["severity"],
      category: r.category as Issue["category"],
      title: r.title,
      detail: JSON.parse(r.detail_json) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  }

  async putScreenshot(runId: string, name: string, bytes: Buffer): Promise<string> {
    assertSafeRelativeName(name);
    const rel = path.posix.join("runs", runId, "screens", name);
    const full = path.join(this.rootDir, "runs", runId, "screens");
    await mkdir(full, { recursive: true });
    await writeFile(path.join(full, name), bytes);
    return rel.replaceAll("\\", "/");
  }

  async getScreenshot(runId: string, relPath: string): Promise<Buffer> {
    const normalized = relPath.replaceAll("\\", "/");
    if (normalized.includes("..")) throw new Error("invalid_path");
    const full = path.join(this.rootDir, normalized);
    if (!full.startsWith(path.join(this.rootDir, "runs", runId))) {
      throw new Error("invalid_path");
    }
    return readFile(full);
  }

  async putA11yTree(runId: string, name: string, snapshot: A11ySnapshot): Promise<string> {
    assertSafeRelativeName(name);
    const dir = path.join(this.rootDir, "runs", runId, "a11y");
    await mkdir(dir, { recursive: true });
    const gz = gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"));
    const fileName = name.endsWith(".gz") ? name : `${name}.gz`;
    await writeFile(path.join(dir, fileName), gz);
    return path.posix.join("runs", runId, "a11y", fileName);
  }

  async getBaseline(urlHash: string): Promise<Baseline | null> {
    const db = this.requireDb();
    const row = db.prepare(`SELECT * FROM baselines WHERE url_hash = ?`).get(urlHash) as
      | {
          url_hash: string;
          url: string;
          screenshot_path: string;
          run_id: string;
          created_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      urlHash: row.url_hash,
      url: row.url,
      screenshotPath: row.screenshot_path,
      runId: row.run_id,
      createdAt: row.created_at,
    };
  }

  async putBaseline(input: PutBaselineInput): Promise<Baseline> {
    const db = this.requireDb();
    const h = urlHash(input.url);
    const rel = path.posix.join("baseline", `${h}.png`);
    const full = path.join(this.rootDir, "baseline", `${h}.png`);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, input.screenshotBytes);
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO baselines (url_hash, url, screenshot_path, run_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(url_hash) DO UPDATE SET
         url = excluded.url,
         screenshot_path = excluded.screenshot_path,
         run_id = excluded.run_id,
         created_at = excluded.created_at`,
    ).run(h, normalizeUrl(input.url), rel, input.runId, createdAt);
    return { urlHash: h, url: normalizeUrl(input.url), screenshotPath: rel, runId: input.runId, createdAt };
  }

  async clearBaselines(): Promise<number> {
    const db = this.requireDb();
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM baselines`).get() as { c: number };
    const c = countRow.c;
    db.prepare(`DELETE FROM baselines`).run();
    const baseDir = path.join(this.rootDir, "baseline");
    try {
      const { readdir, unlink } = await import("node:fs/promises");
      const files = await readdir(baseDir);
      for (const f of files) {
        if (f.endsWith(".png")) await unlink(path.join(baseDir, f));
      }
    } catch {
      // ignore
    }
    return c;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

/**
 * Create a trace store rooted at `.lookout/` (or a test directory).
 */
export function createStore(rootDir: string): StoreWithRoot {
  const impl = new SqliteStore(rootDir);
  return Object.assign(impl, { rootDir });
}

export async function readA11ySnapshotFromStore(
  storeRoot: string,
  relPath: string,
): Promise<A11ySnapshot> {
  const full = path.join(storeRoot, relPath.replaceAll("\\", "/"));
  const buf = await readFile(full);
  const json = gunzipSync(buf).toString("utf8");
  return JSON.parse(json) as A11ySnapshot;
}

export { diffIssuesByFingerprint, issueFingerprint, type IssuesDiff } from "./issue-diff.js";
export {
  buildRunExportBundle,
  type ExportableStore,
  type GoalStepExport,
  type RunExportBundleV2,
} from "./run-export.js";
