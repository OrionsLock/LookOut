> Vendored from the original Lookout spec. The in-repo copy under docs/spec/ is now authoritative going forward.

# Lookout — Phased Release Plan

Each phase ends with a **working, demoable, publishable** increment. Do not start a phase before the previous one meets its Definition of Done.

---

## Phase 0.1 — Walking Skeleton

**Goal.** `lookout run --url <url>` crawls a web app against one hardcoded goal, writes screenshots + console errors + a11y violations to `.lookout/runs/<id>/`, and produces a minimal static HTML report.

**Scope.**
- Monorepo scaffolding (pnpm workspace, tsup, vitest, eslint, tsconfig base).
- `@lookout/types`, `@lookout/config`, `@lookout/store`, `@lookout/llm`, `@lookout/recorders`, `@lookout/core`, `@lookout/reporter`, `@lookout/cli`.
- Anthropic provider only in `@lookout/llm`.
- Auth modes: `none` and `credentials`.
- Single goal per run acceptable (no parallelism yet).
- HTML report is bare-bones: summary + per-step timeline with screenshots + issue list.
- Exit codes working.

**Out of scope.** Visual regression, UX audit, Playwright emitter, `init` command scaffolding a sample config, `ci` command, multiple LLM providers, `exploration` mode, parallelism.

**Definition of Done.**
- `pnpm install && pnpm build && pnpm test` all green.
- Against `examples/nextjs-demo` (a bundled sample Next.js app), `lookout run` completes in under 2 minutes and produces a report that opens in a browser.
- Report shows: run metadata, goals + statuses, every step with before/after screenshots, console errors, a11y violations.
- Exit code 1 when the demo app has a seeded bug (a broken `<button>` handler); exit code 0 when fixed.
- `tasks/phase-0.1.md` checklist fully checked off.

---

## Phase 0.2 — Baselines & Visual Regression

**Goal.** `lookout baseline promote` freezes the current run's screenshots as the golden baseline. Subsequent runs diff against it using pixelmatch; visual regressions appear as issues in the report.

**Scope.**
- `@lookout/analyzers` package created with pixelmatch integration.
- `lookout baseline` command (subcommands: `promote`, `list`, `clear`).
- Baselines stored per URL hash in `.lookout/baseline/`.
- Report gains a "Visual Diff" tab showing side-by-side + overlay.
- Threshold configurable per `config.checks.visualRegression.threshold`.

**Out of scope.** Per-component baselines, responsive viewport diffs, flaky-pixel detection.

**DoD.**
- After `lookout baseline promote`, next run shows 0 visual regressions on unchanged pages.
- Introducing a visible UI change to the demo app surfaces a visual diff issue with a highlighted overlay.
- Pixelmatch threshold correctly ignores sub-threshold changes.

---

## Phase 0.3 — Playwright Test Emitter

**Goal.** Successful goals become `.spec.ts` files in `tests/lookout/` that run under Playwright without modification.

**Scope.**
- `@lookout/emitter-playwright` package.
- `lookout generate-tests` command.
- Emitter consumes traces for goals with `status = complete` and emits a `test(...)` block per goal.
- Emitted selectors use Playwright's role/label/text locators in priority order (not raw CSS).
- Generated files include a header comment identifying them as Lookout-generated, with run id and timestamp.

**Out of scope.** Re-generating and diffing over existing files, handling param fixtures beyond env vars for credentials, test retries/fixtures config.

**DoD.**
- Given a successful goal on the demo app, the emitted `.spec.ts` runs green under `npx playwright test`.
- If the demo app is broken, the emitted spec fails at the expected step (verifies generated assertions are meaningful, not trivially `true`).
- Regenerating overwrites cleanly with a warning if the file is newer than the source run.

---

## Phase 0.4 — UX Audit & Multi-Provider LLM

**Goal.** Add an AI-powered UX audit pass; add OpenAI and Ollama providers to the LLM adapter.

**Scope.**
- UX audit runs after the crawl. For each unique page visited, send (screenshot + a11y tree summary) to the LLM with a rubric prompt. Store scores + concerns as `issues` with `category = 'ux'`.
- Rubric covers: information density, primary CTA clarity, copy clarity, visual hierarchy, cognitive load.
- Report gets a "UX Audit" tab.
- `@lookout/llm` gains `OpenAIProvider` and `OllamaProvider` alongside `AnthropicProvider`.
- Config accepts all three provider values; router picks adapter based on string.

**DoD.**
- UX audit produces consistent, typed output (validated with Zod).
- `LOOKOUT_LLM_PROVIDER=openai` works end-to-end with a valid `OPENAI_API_KEY`.
- `LOOKOUT_LLM_PROVIDER=ollama LOOKOUT_LLM_BASE_URL=http://localhost:11434` works with a local model.
- Provider adapters behind a single `LLMClient` interface — no caller-side switches.

---

## Phase 0.5 — Parallel Agents & CI Mode

**Goal.** Run multiple goals in parallel. Add a `ci` command that produces JUnit XML and non-TTY output.

**Scope.**
- Orchestrator spawns up to `config.crawl.maxParallelAgents` Explorer instances, each in its own browser context.
- Rate limiting on LLM calls (token bucket per provider).
- `lookout ci` command: no colors, no spinners, writes JUnit XML to `--junit <path>`, non-zero on regression.
- GitHub Actions example workflow added to `docs/ci.md`.

**DoD.**
- With `maxParallelAgents: 3`, a 5-goal run completes faster than the equivalent sequential run (verifiable via timestamps).
- `lookout ci --junit results.xml` produces a valid JUnit XML file.
- Example GitHub Action runs on a PR to `examples/nextjs-demo` and reports results.

---

## Phase 1.0 — Public Launch

**Goal.** Ship publicly. Docs site. Demo video. Example repos. Show HN.

**Scope.**
- Docusaurus docs site in `docs/`, deployed to GitHub Pages.
- Recorded 90-second demo video embedded in the README.
- Example repos: Next.js app, Vite/React app, each with a working `lookout.config.ts` and a GitHub Action.
- `lookout init` scaffolds a config file, adds `.lookout/` to `.gitignore`, and detects framework (Next.js, Vite, CRA) to pre-fill `baseUrl`.
- Changesets-based release pipeline publishes all packages to npm on tagged releases.
- `@lookout/orionslock-attribution.md` in the repo root — a short doc explaining the relationship to OrionsLock.
- README polished, badges correct, screenshot of a real report at the top.

**DoD.**
- `npx lookout init && npx lookout run` works from a fresh clone of either example repo.
- Docs site live at `orionslock.github.io/lookout` (or similar).
- Tagged `v1.0.0` release on GitHub with all packages published to npm.
- At least 5 self-testing runs executed against real third-party web apps (Pulse dashboard, a public SaaS landing page, etc.) produce sensible reports without crashing.

---

## Release cadence

- Phase 0.1 → 0.5: internal milestones, version bumps `0.1.0` → `0.5.0`.
- Each `0.x.0` release is tagged on GitHub and published to npm under the `next` tag.
- `1.0.0` is the first stable release with a public announcement.

---

Next: read the per-package specs in `specs/` starting with `specs/types.md`, then implement following `tasks/phase-0.1.md`.
