> Vendored from the original Lookout spec. The in-repo copy under docs/spec/ is now authoritative going forward.

# Lookout — AI Coder Build Package

> You are an AI coder (Cursor, Claude Code, or similar) about to build an open-source project called **Lookout**. This repository contains the complete specification. Read this file first, then follow the path below.

## What you're building

An open-source CLI tool that acts as an AI QA engineer for web apps. Given a URL and credentials, it:

1. **Crawls the app like a real user** using Playwright + an LLM (Anthropic Claude by default) that reasons over screenshots and accessibility trees.
2. **Records everything**: screenshots, console errors, network failures, accessibility violations, performance metrics, visual diffs against a golden baseline.
3. **Emits three artifacts**: a single-file HTML bug report, a set of runnable Playwright test specs derived from successful flows, and a Claude-scored UX audit.

## Positioning

> "Point it at a URL. It acts like your most thorough user, and tells you everything that's broken."

## How to use this spec

Work the phases in order. Do not skip ahead. Each phase ships a working, releasable increment.

1. **Read `docs/ARCHITECTURE.md`** — the frozen system design. This is the authoritative reference for how components relate.
2. **Read `docs/CONVENTIONS.md`** — naming, coding style, repo layout, and explicit "do not do" list. Treat this as inviolable.
3. **Read `docs/PHASES.md`** — the sequential release plan (v0.1 → v1.0). Each phase has a definition of done.
4. **Read `specs/*.md`** — per-package specifications with exact APIs, dependencies, and data shapes.
5. **Work `tasks/phase-*.md`** — concrete tickets. Start with `tasks/phase-0.1.md` and do not start the next phase until the current one meets its definition of done.

## Rules of engagement for the AI coder

- **Never invent out-of-spec dependencies.** If a library is not listed in `specs/`, do not add it. If you believe one is needed, open a task note in `tasks/NOTES.md` and proceed with an inlined alternative.
- **Never couple to OrionsLock or Pulse.** Lookout is a standalone project. The only OrionsLock reference is an attribution line in the README footer. No API calls to OrionsLock services, no environment variables named `PULSE_*` or `ORIONSLOCK_*`, no imports from OrionsLock packages.
- **Tests are not optional.** Every package has a Vitest test suite. Every phase's DoD requires tests green.
- **The CLI must work end-to-end at every phase boundary.** A user should be able to `pnpm install && pnpm build && ./packages/cli/bin/lookout run --url http://example.com` and get something useful, even in v0.1.
- **Commit discipline.** One commit per task. Conventional Commits format (`feat(core): add agent loop`, `test(recorders): cover axe integration`).

## Name & branding

- Project name: **Lookout**
- npm scope: `@lookout` (if available at publish time) or `@orionslock-lookout` fallback
- Binary: `lookout`
- GitHub: `github.com/orionslock/lookout` (to be created)
- License: MIT
- Tagline: *"An AI QA engineer for your web app."*
- Attribution: README footer reads *"Lookout is an open-source project by [OrionsLock](https://orionslock.com)."* No other cross-promotion.

## How to know you're done (all phases)

When `lookout run` on a real web app produces:
- A report HTML file you can open in a browser
- A set of `.spec.ts` files that run under Playwright without modification
- A UX audit section with per-page scores
- Exit code 0/1/2 appropriate for CI
- Zero hangs, crashes, or swallowed errors

And when `pnpm test` passes across all packages, and `pnpm lint` is clean, and `pnpm build` produces publishable artifacts.

---

Now read `docs/ARCHITECTURE.md`.
