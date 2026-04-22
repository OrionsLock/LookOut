> Vendored from the original Lookout spec. The in-repo copy under docs/spec/ is now authoritative going forward.

# Lookout — Architecture

This document is the **authoritative system design**. Treat it as frozen. If implementation forces a change, document the deviation in `tasks/NOTES.md` with reasoning before proceeding.

## High-level diagram

```
┌─────────────────────────────────────────────────────────┐
│  CLI  @lookout/cli                                      │
│  Commands: init | run | report | baseline | ci         │
│           | generate-tests                              │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────▼────────────┐
        │  Orchestrator          │  @lookout/core
        │  - loads config        │
        │  - spawns agents       │
        │  - aggregates results  │
        └───┬──────────────┬─────┘
            │              │
  ┌─────────▼──────┐  ┌────▼──────────────┐
  │  Explorer      │  │  Recorders        │  @lookout/recorders
  │  (agent loop)  │  │  (passive)        │
  │  @lookout/core │  │                   │
  │                │  │  • screenshots    │
  │  perceive →    │  │  • a11y (axe)     │
  │  plan (LLM) →  │  │  • console        │
  │  act →         │  │  • network        │
  │  verify        │  │  • performance    │
  └───────┬────────┘  └─────┬─────────────┘
          │                 │
          └────────┬────────┘
                   │
         ┌─────────▼──────────┐
         │  Trace Store       │  @lookout/store
         │  .lookout/         │
         │  ├─ runs.db        │  (better-sqlite3)
         │  ├─ runs/<id>/     │
         │  │   ├─ screens/   │
         │  │   └─ trace.json │
         │  └─ baseline/      │
         └─────────┬──────────┘
                   │
       ┌───────────┴──────────────┐
       │                          │
┌──────▼───────────┐    ┌─────────▼──────────┐
│  Analyzers       │    │  Emitters          │  @lookout/reporter
│  @lookout/       │    │                    │  @lookout/emitter-playwright
│  analyzers       │    │  • HTML report     │
│                  │    │  • Playwright spec │
│  • pixelmatch    │    │  • JSON trace      │
│  • UX rubric     │    │                    │
│    (via LLM)     │    │                    │
│  • severity      │    │                    │
└──────────────────┘    └────────────────────┘
```

## The agent loop (Explorer)

Every step in `@lookout/core`'s explorer executes this state machine:

```
┌─────────────┐
│  PERCEIVE   │  capture screenshot + a11y tree + url
└──────┬──────┘
       │
┌──────▼──────┐
│   PLAN      │  send perceive payload to LLM with system prompt
│             │  system prompt includes: current goal, step history,
│             │  action schema
│             │  LLM returns one Action
└──────┬──────┘
       │
┌──────▼──────┐
│    ACT      │  Playwright executes the Action
│             │  captures before/after screenshots
│             │  captures network + console during
└──────┬──────┘
       │
┌──────▼──────┐
│   VERIFY    │  did URL change? did errors appear?
│             │  did assertion pass? assign verdict.
└──────┬──────┘
       │
       ▼
  record step → loop back to PERCEIVE
  unless: goal complete | step budget exhausted | agent returned `stuck`
```

### Action schema

The LLM returns exactly one of these at each PLAN step:

```ts
type Action =
  | { kind: "click";    target: TargetRef; intent: string }
  | { kind: "fill";     target: TargetRef; value: string; intent: string }
  | { kind: "select";   target: TargetRef; value: string; intent: string }
  | { kind: "navigate"; url: string;        intent: string }
  | { kind: "wait";     ms: number;         intent: string }
  | { kind: "assert";   description: string; expectation: string }
  | { kind: "complete"; reason: string }
  | { kind: "stuck";    reason: string };

type TargetRef = {
  // Human-readable description from the a11y tree, e.g. 'button "Create new key"'
  description: string;
  // A11y node ref (for resolution), e.g. { role: "button", name: "Create new key" }
  role?: string;
  name?: string;
  // Optional selector hint if LLM could infer from snapshot
  selectorHint?: string;
};
```

### Target resolution

When the LLM returns a `TargetRef`, the Explorer's **resolver** converts it to a stable Playwright locator in this priority order:

1. `data-testid` attribute (if present in the a11y snapshot)
2. `page.getByRole(role, { name })` if role + name both present
3. `page.getByLabel(name)` for form inputs
4. `page.getByText(name)` as a fallback
5. If all fail → record `resolution_failed` and ask LLM to pick again

The resolved locator string is stored alongside the action. This is what gets emitted into generated `.spec.ts` files later.

## Why accessibility tree over DOM

Raw DOM blows context and confuses the model with noise (class names, hydration markers, ad scripts). The accessibility tree gives you semantic structure: `button "Create new key"` instead of `<div class="btn-primary-xl_3af9">`. Playwright exposes this via `page.accessibility.snapshot()`. **Always use it for LLM context. Never send raw HTML.**

## Packages

All packages live in a pnpm workspace. Each is independently publishable.

| Package                         | Role                                           | Depends on                      |
|---------------------------------|------------------------------------------------|---------------------------------|
| `@lookout/cli`                  | Command-line entry point                       | all others                      |
| `@lookout/core`                 | Orchestrator, Explorer agent loop              | `llm`, `store`, `recorders`     |
| `@lookout/llm`                  | LLM provider adapters (Anthropic/OpenAI/...)   | -                               |
| `@lookout/recorders`            | Passive data collectors                        | -                               |
| `@lookout/analyzers`            | Post-run analysis (visual diff, UX, severity) | `store`, `llm`                  |
| `@lookout/store`                | SQLite + filesystem trace store                | -                               |
| `@lookout/reporter`             | Static HTML report generator                   | `store`                         |
| `@lookout/emitter-playwright`   | Generates `.spec.ts` files from traces         | `store`                         |
| `@lookout/config`               | Config loading + schema validation             | -                               |
| `@lookout/types`                | Shared TypeScript types                        | -                               |

## Data flow: one run, end to end

1. User runs `lookout run`.
2. CLI loads `lookout.config.ts` via `@lookout/config`, validates with Zod.
3. CLI creates a new run row in the store (`@lookout/store`), returns run_id.
4. CLI hands config + run_id to `@lookout/core` orchestrator.
5. Orchestrator launches Playwright browser, performs auth flow if configured.
6. Orchestrator iterates through `config.crawl.goals`. For each goal:
   - Spawns an Explorer instance with goal + shared browser context (new tab).
   - Explorer runs the agent loop. On each step, Recorders collect data.
   - Step data is persisted to the store as it happens (not buffered).
7. Once all goals done (or budget exhausted), orchestrator runs Analyzers:
   - Pixelmatch against baseline (if baseline exists for URL hash).
   - UX rubric via LLM on key screenshots.
   - Severity scoring across all collected issues.
8. Orchestrator invokes `@lookout/reporter` → writes `.lookout/runs/<id>/report.html`.
9. If `config.emitters.playwright` enabled, invokes `@lookout/emitter-playwright` → writes `tests/lookout/*.spec.ts`.
10. CLI returns exit code: 0 clean / 1 regressions found / 2 execution errors.

## Storage schema

SQLite via `better-sqlite3`. File: `.lookout/runs.db`. No migrations in v0.1; schema initialized on first run.

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,              -- ULID
  started_at INTEGER NOT NULL,      -- epoch ms
  ended_at INTEGER,
  base_url TEXT NOT NULL,
  commit_sha TEXT,                  -- captured from git if available
  verdict TEXT,                     -- 'clean' | 'regressions' | 'errors' | 'running'
  summary_json TEXT
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,              -- ULID
  run_id TEXT NOT NULL REFERENCES runs(id),
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,             -- 'pending' | 'running' | 'complete' | 'stuck' | 'error'
  steps_taken INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  ended_at INTEGER
);

CREATE TABLE steps (
  id TEXT PRIMARY KEY,              -- ULID
  goal_id TEXT NOT NULL REFERENCES goals(id),
  idx INTEGER NOT NULL,             -- step number within goal
  url TEXT NOT NULL,
  action_json TEXT NOT NULL,        -- serialized Action
  selector_resolved TEXT,           -- resolved Playwright locator, or null if failed
  screenshot_before TEXT,           -- relative path
  screenshot_after TEXT,
  a11y_tree_path TEXT,
  verdict TEXT NOT NULL,            -- 'ok' | 'no-op' | 'error' | 'resolution-failed'
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY,              -- ULID
  run_id TEXT NOT NULL REFERENCES runs(id),
  step_id TEXT REFERENCES steps(id),
  severity TEXT NOT NULL,           -- 'critical' | 'major' | 'minor' | 'info'
  category TEXT NOT NULL,           -- 'a11y' | 'console' | 'network' | 'visual' | 'flow' | 'ux' | 'perf'
  title TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE baselines (
  url_hash TEXT PRIMARY KEY,        -- sha256(normalized_url)
  url TEXT NOT NULL,
  screenshot_path TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_steps_goal ON steps(goal_id, idx);
CREATE INDEX idx_issues_run ON issues(run_id, severity);
CREATE INDEX idx_goals_run ON goals(run_id);
```

## Filesystem layout (a single run)

```
.lookout/
├── runs.db
├── runs/
│   └── 01HXXXXXXXXXXXXXXXXX/       (run ULID)
│       ├── trace.json              (denormalized, for the HTML report to load)
│       ├── report.html             (single static file, self-contained)
│       ├── screens/
│       │   ├── 01HXXX...before.png
│       │   ├── 01HXXX...after.png
│       │   └── ...
│       └── a11y/
│           └── 01HXXX....json
└── baseline/
    └── <url_hash>.png
```

## Config file (authoritative shape)

See `specs/config.md` for full schema. Summary:

```ts
import { defineConfig } from "@lookout/config";

export default defineConfig({
  baseUrl: string,
  auth: { type: "none" | "credentials" | "storageState", ... },
  crawl: {
    maxStepsPerGoal: number,
    maxParallelAgents: number,
    viewport: { width, height },
    goals: Array<{ id: string; prompt: string }>,
    exploration?: { enabled: boolean; budget: number },
  },
  checks: {
    a11y?: { enabled: boolean; failOn: "minor" | "moderate" | "serious" | "critical" },
    visualRegression?: { enabled: boolean; threshold: number },
    console?: { failOn: Array<"log" | "warn" | "error"> },
    network?: { failOn: Array<string | RegExp> },
    performance?: { enabled: boolean },
  },
  llm: {
    provider: "anthropic" | "openai" | "google" | "ollama",
    model: string,
    vision: boolean,
    apiKey?: string,      // else read from env
    baseUrl?: string,     // for proxy overrides
  },
  emitters: {
    playwright?: { enabled: boolean; outDir: string },
  },
  report: {
    format: Array<"html" | "json">,
    openAfterRun: boolean,
  },
});
```

## Exit codes

- `0` — clean run, no regressions, no critical/major issues
- `1` — run completed but found regressions or critical/major issues
- `2` — execution error (config invalid, browser crashed, LLM unreachable)

CI scripts rely on this. Do not change without updating all tests and docs.

## What is explicitly out of scope for v1.0

- Cloud/hosted dashboards (future OrionsLock product, not part of OSS)
- Multi-browser matrix (Chromium only in v1.0; Firefox/WebKit planned for v2)
- Mobile emulation beyond viewport sizing
- Recording interactive login flows with MFA (documented workaround: use `storageState` auth mode)
- Test generation for flaky flows (generate only from `status = complete` goals)
- Running inside a user's existing Playwright project as a plugin (v2 consideration)

---

Next: read `docs/CONVENTIONS.md`.
