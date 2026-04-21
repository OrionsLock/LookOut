import type Database from "better-sqlite3";

/**
 * Ordered, append-only list of schema migrations. Each migration runs exactly
 * once per database and is tracked in the `schema_migrations` table.
 *
 * Never reorder or rewrite an existing migration — add a new one at the end.
 * If a migration genuinely needs to be replaced, add a compensating migration
 * after it; older databases should still converge to the same end state.
 */
export type Migration = {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    up(db) {
      db.exec(`
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
    },
  },
  {
    id: 2,
    name: "steps_unique_goal_idx",
    up(db) {
      // A unique constraint on (goal_id, idx) prevents a silent duplicate-write
      // race when two workers record the same step index for the same goal.
      // SQLite lets us express this with a unique index without touching the
      // original CREATE TABLE — which also keeps older databases happy.
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_steps_goal_idx ON steps(goal_id, idx);`);
    },
  },
];

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

/** Apply any migrations the database has not yet seen. */
export function runMigrations(db: Database.Database): void {
  ensureMigrationsTable(db);
  const applied = new Set<number>(
    (db.prepare(`SELECT id FROM schema_migrations`).all() as Array<{ id: number }>).map((r) => r.id),
  );
  const record = db.prepare(
    `INSERT OR REPLACE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)`,
  );
  // Wrap each migration in its own transaction so a partial apply can't wedge
  // later migrations behind a committed-but-unrecorded one.
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      record.run(m.id, m.name, Date.now());
    });
    tx();
  }
}

/** Exposed for tests / diagnostics. */
export function listKnownMigrations(): Readonly<Array<Pick<Migration, "id" | "name">>> {
  return migrations.map((m) => ({ id: m.id, name: m.name }));
}
