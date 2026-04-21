# Changelog

## Unreleased

- **Docs**: README reframed around thesis + differentiators + visual preview; **`docs/GITHUB_REPO_SETTINGS.md`** for description / website / topics / social preview / **`v0.5.0`** release checklist; **`docs/assets/github-social-preview.png`** (1280×640) for GitHub social upload and README hero.
- **Store**: `readA11ySnapshotFromStore` validates relative paths under the store root; **`listStepsForGoal`** / **`listIssuesForRun`** safely parse stored JSON (`ActionSchema`, fallbacks on corrupt data).
- **MCP**: Optional **`LOOKOUT_MCP_ROOT`** env restricts tool `cwd`; **`pnpm run`** / docs updated.
- **Explorer**: **`navigate`** allows only **http/https**; **`wait`** uses `setTimeout` instead of deprecated **`page.waitForTimeout`**; invalid **network** regex patterns in config are skipped.
- **CLI**: **`lookout ci`** retries when **`orch.run()`** fails (same `--retries` budget); **`--max-steps`** validated as integer **1–200**.
- **Core**: Warn when configured goals do not all resolve from the DB.

## 0.5.0 — Parallel Agents & CI Mode

- Parallel goal execution with configurable concurrency
- `lookout ci` with JUnit XML output and machine-readable logs
- Shared LLM rate limiting across agents
- Mock LLM provider (`llm.provider: mock`) for CI and evals; smoke config in `examples/nextjs-demo/lookout.smoke.json`
- Optional crawl exploration pass plus `assert` mini-DSL (`url:`, `title:`, `text:`, or body substring)
- `report.traceOnFailure` saves Playwright trace zips when a goal fails or is stuck
- `lookout heal` for LLM-assisted markdown from the latest run’s issues
- Google Gemini LLM provider; optional `onUsage` / run `summary.llmUsage` surfaced in HTML reports
- `@lookout/mcp-server` (stdio MCP: list runs / list issues)
- GitHub Actions job builds the Next.js demo, waits on port 3000, then runs `lookout ci` against the smoke config
- `lookout runs list|diff|export` for comparing issue fingerprints across runs and exporting JSON bundles for CI or sharing
- `lookout ci --retries <0-5>` re-runs on failure; stderr JSON includes `flake_suspected` when a later attempt passes; JUnit reflects the winning or final run
- Run export **v2** adds `goalSteps` and `artifacts.traceZips`; MCP tools `lookout_diff_runs` and `lookout_export_run`; SQLite stores are closed after each MCP call
- `lookout ci --strict-retry` with `--retries`: exit 1 if a retry was needed to pass; stderr `will_retry` before each retry after a failed attempt
- `lookout verify-run` — LLM-as-judge (`accept`/`reject`) over export bundle v2; `lookout runs emit-playwright <runId> --out <dir>`; shared `emitAuthFromConfig` for emitter auth
- `pnpm run test:eval` and **`docs/LAUNCH_REVIEW.md`** pre-launch checklist
- Root **`vitest.config.ts`** with **`test.projects`** (`packages/*/vitest.config.ts`); per-package configs use **`defineProject`** (replaces deprecated `vitest.workspace.ts`)
- Workspace packages: **`exports.types`** before **`import`/`require`** in `package.json` (Node resolution + cleaner Vite/esbuild resolution)
- **`playwright:install`** uses **`install --with-deps chromium`** so Linux CI gets system libraries for Chromium; GitHub Actions uses **`.node-version`** for Node
- **`eslint.config.mjs`** (was `.js`) so Node treats the flat config as ESM on Linux CI (`import` / `export default`)
- **CI**: `pnpm build` before lint/test so workspace **`exports.types`** (`dist/*.d.ts`) exists for type-aware ESLint and Vitest resolution

## 0.4.0 — UX Audit & Multi-Provider LLM

- UX audit pass with typed scores and concerns
- OpenAI and Ollama LLM providers alongside Anthropic

## 0.3.0 — Playwright Test Emitter

- `lookout generate-tests` emits runnable Playwright specs from completed goals

## 0.2.0 — Baselines & Visual Regression

- `lookout baseline promote|list|clear` and pixelmatch-based visual diffs in reports

## 0.1.0 — Walking Skeleton

- Monorepo with CLI, core explorer, recorders, store, reporter, and Anthropic LLM adapter
- `lookout run` produces `.lookout` artifacts and an HTML report
