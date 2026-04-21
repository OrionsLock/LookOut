# Lookout

[![CI](https://github.com/OrionsLock/LookOut/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OrionsLock/LookOut/actions/workflows/ci.yml)

An AI QA engineer for your web apps. Point it at a URL; it explores with Playwright and an LLM, records issues, and produces HTML reports.

Lookout is an open-source project by [OrionsLock](https://orionslock.com).

## Quick start

```bash
pnpm install
pnpm build
pnpm exec lookout --help
```

See `examples/nextjs-demo` for a runnable demo application.

## Golden path (local smoke)

This matches the CI end-to-end check: mock LLM, no API keys, Chromium via Playwright. `pnpm run playwright:install` uses **`--with-deps`** on Linux (CI installs apt libraries); on Windows and macOS the deps step is effectively skipped.

```bash
pnpm install
pnpm run playwright:install
pnpm build
pnpm --filter nextjs-demo build
pnpm --filter nextjs-demo start
```

In another terminal, from the repo root:

```bash
pnpm exec lookout ci -C examples/nextjs-demo --config lookout.smoke.json
```

`lookout ci` exits non-zero on regressions and can emit JUnit with `--junit out.xml`. Use `--retries <0-5>` to re-run the full crawl after a failing attempt; the process exits 0 if **any** attempt passes, and stderr includes JSON with `flake_suspected` when a later attempt succeeds. Combine with **`--strict-retry`** so a pass that only happened after a failed attempt still exits **1** (strict mainline). Failed attempts that will retry also log `will_retry` on stderr. Use `lookout run` for interactive runs and HTML reports.

After a run, optional second gate: **`pnpm exec lookout verify-run`** (uses the configured LLM to output `accept` / `reject` from the export bundle; exit 1 on reject; mock provider always accepts).

Emit Playwright specs from a **specific** run id: **`pnpm exec lookout runs emit-playwright <runId> --out <dir>`** (same emitter as `generate-tests`; only **complete** goals become files).

## Trust: compare runs and export bundles

After any run, `.lookout` holds history. From the project root:

```bash
pnpm exec lookout runs list
pnpm exec lookout runs list --json
pnpm exec lookout runs diff <runIdA> <runIdB>
pnpm exec lookout runs diff <runIdA> <runIdB> --json
pnpm exec lookout runs export <runId> --out run-bundle.json
```

`runs diff` groups issues by a stable fingerprint (`severity`, `category`, `title`) so you can see what changed between two runs (for example main vs a PR). `runs export` writes **bundle v2**: run row, goals, per-goal step summaries (`actionKind`, verdicts, screenshot/a11y paths), issues, `report.html` path, and any `trace*.zip` paths under that run directory.

## MCP server

The `@lookout/mcp-server` package exposes stdio tools: `lookout_list_runs`, `lookout_list_issues`, **`lookout_diff_runs`**, and **`lookout_export_run`** (same diff/export semantics as the CLI) for Cursor and other MCP clients. After `pnpm build`, run `pnpm exec lookout-mcp` from the repo root (binary `lookout-mcp` in that package), or point your MCP server command at `packages/mcp-server/dist/main.js` with working directory set to a project that contains `.lookout`.

## Development

```bash
pnpm lint
pnpm test
pnpm build
pnpm run test:eval
```

`pnpm run test:eval` runs a small fast subset (judge JSON parsing, issue diff, export bundle). For a human launch pass, see **`docs/LAUNCH_REVIEW.md`**.

Browser-backed tests in `@lookout/core` are skipped automatically when Playwright’s Chromium binary is not installed (`pnpm run playwright:install`).

## License and contributing

MIT — see [`LICENSE`](LICENSE). For PRs and local checks, see [`CONTRIBUTING.md`](CONTRIBUTING.md). Security disclosures: [`SECURITY.md`](SECURITY.md).

Canonical repo: [github.com/OrionsLock/LookOut](https://github.com/OrionsLock/LookOut).
