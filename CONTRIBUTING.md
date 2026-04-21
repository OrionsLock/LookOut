# Contributing to Lookout

Thanks for helping improve Lookout. This project uses **pnpm**, **Node 20+**, and a **workspace** layout under `packages/*` and `examples/*`.

## Before you open a PR

1. Install dependencies: `pnpm install`
2. Install Playwright Chromium (needed for full tests and local smoke):  
   `pnpm run playwright:install`
3. Run checks from the repo root (build **before** lint so `dist/*.d.ts` exists for workspace `types` resolution):
   - `pnpm build`
   - `pnpm lint`
   - `pnpm test` (Vitest reads **`vitest.config.ts`** and **`test.projects`** for each `packages/*/vitest.config.ts`)
4. Optional quick subset: `pnpm run test:eval`

## Smoke parity with CI

From the repo root, after building the demo app:

```bash
pnpm --filter nextjs-demo build
pnpm --filter nextjs-demo start
```

In another terminal:

```bash
pnpm exec lookout ci -C examples/nextjs-demo --config lookout.smoke.json
```

See **`docs/LAUNCH_REVIEW.md`** for trust semantics (retries, strict mode, judge).

## Code style

- Match existing patterns in the touched package; avoid unrelated refactors.
- Prefer focused commits and clear PR titles.

## Repository URL

Canonical remote: **https://github.com/OrionsLock/LookOut**. Forks should update **`package.json`** `repository` and the CI badge in **`README.md`** if you publish from a different slug.
