# Lookout launch review (internal)

Concise pre-launch pass over trust, safety, and known limits. This is not a warranty; re-run after major changes.

## Build & gates

- `pnpm install && pnpm run playwright:install` (for full tests / local integration).
- `pnpm run build` — all `packages/*` emit.
- `pnpm test` — unit + package tests; core orchestrator integration skips without Chromium.
- `pnpm lint` — expect only a few `no-non-null-assertion` warnings unless tightened.
- `pnpm run test:eval` — fast sanity for judge JSON parsing + issue diff + export bundle.

## Trust & CI semantics

- **`lookout ci --retries N`**: can exit 0 if a later attempt passes after failures; stderr emits `flake_suspected` when that happens.
- **`lookout ci --retries N --strict-retry`**: a pass that required a retry exits **1** (JUnit still reflects the passing attempt’s run for debugging). Use on mainline when retry tolerance is unacceptable.
- **`lookout verify-run`**: optional second gate — LLM judge `accept`/`reject` from export bundle; exit 1 on `reject`. Mock provider always accepts.

## Security & data

- Runs store screenshots and traces on disk under `.lookout/`; do not commit `.lookout` to git (init appends `.gitignore`).
- `heal` / `verify-run` send run summaries to the configured LLM provider; use **mock** in CI or air-gapped evals.
- MCP stdio tools read the store on disk; only point MCP at trusted project roots.

## Known limits (honest)

- Playwright emitter skips non-**complete** goals; emitted specs may contain `// TODO` for unresolved selectors.
- Issue diff fingerprint is `severity + category + title` (not DOM-level); dynamic titles may look “new” every run.
- Judge is a single extra model call with heuristic JSON extraction — not a formal proof system.

## Launch checklist (human)

- [ ] Tag / version bump in `CHANGELOG` and CLI `--version` if releasing.
- [ ] Run CI workflow on `main` after merge.
- [ ] Smoke: `lookout ci` on `examples/nextjs-demo` with `lookout.smoke.json`.
- [ ] Optional: document public communication (license, security contact, roadmap issue).
