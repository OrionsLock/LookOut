> Vendored from the original Lookout spec. The in-repo copy under docs/spec/ is now authoritative going forward.

# Master Build Prompt

Copy-paste this as the first message to your Cursor/Claude Code agent.

---

You are building an open-source project called **Lookout**. The full specification lives in this repository under `README.md`, `docs/`, `specs/`, and `tasks/`. Read them before writing any code.

## Your job

Build Lookout phase by phase, following `docs/PHASES.md`. Start with Phase 0.1 by working through `tasks/phase-0.1.md` top to bottom. Do not start Phase 0.2 until Phase 0.1's Definition of Done is green.

## Rules

1. **Specs are authoritative.** If a spec says "use X library," use X. If you genuinely believe a different approach is better, open `tasks/NOTES.md`, write a short rationale, wait for human sign-off, then proceed. Do not silently deviate.
2. **Conventions are inviolable.** `docs/CONVENTIONS.md` lists forbidden patterns. Every commit is checked against it.
3. **Tests are required.** Every task in `tasks/*.md` has test acceptance criteria. Do not mark a task complete until tests pass.
4. **One commit per task.** Use Conventional Commits. Don't bundle unrelated changes.
5. **Ask before guessing.** If a spec is ambiguous, ask before implementing. Ambiguity in a spec is a spec bug, not a license to improvise.
6. **Dogfood constantly.** `examples/nextjs-demo/` is a real Next.js app with seeded bugs. Use it. Every time you finish a feature, run Lookout against it and see if the feature works end-to-end.
7. **No OrionsLock/Pulse coupling.** Lookout is standalone OSS. The only acceptable reference is the one-line README footer attribution.

## How to work each task

For every task ticket:

1. Read the ticket in `tasks/phase-*.md`.
2. Re-read the relevant spec in `specs/`.
3. Write the failing test(s) first.
4. Implement until tests pass.
5. Run `pnpm lint && pnpm test && pnpm build` — all must be green.
6. Commit with a Conventional Commit message.
7. Check off the ticket in the task file.

## When you're stuck

- Unclear requirement? Ask the human.
- Spec contradiction? Open `tasks/NOTES.md`, describe both readings, ask which is right.
- Flaky test? Don't retry until it passes — fix the flakiness (a bad test is worse than no test).
- Dependency problem? Try the simple solution first (native APIs, fewer deps) before adding a library.

## Phase gates

Before declaring a phase done, verify:

- [ ] All tasks in the phase's task file are checked off
- [ ] `pnpm install && pnpm build && pnpm test && pnpm lint` clean from a fresh clone
- [ ] The phase's Definition of Done (see `docs/PHASES.md`) is met
- [ ] A short `CHANGELOG.md` entry has been added for this phase
- [ ] A demo run has been captured (screenshot or recording) showing the new capabilities

Begin with Phase 0.1 now. Open `tasks/phase-0.1.md`.
