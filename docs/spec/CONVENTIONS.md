> Vendored from the original Lookout spec. The in-repo copy under docs/spec/ is now authoritative going forward.

# Lookout — Conventions

Inviolable rules for the AI coder. Violations must be reverted.

## Repository layout

```
lookout/
├── .github/
│   └── workflows/
│       ├── ci.yml              # lint, test, build on PR
│       └── release.yml         # changesets release flow
├── .changeset/
│   └── config.json
├── packages/
│   ├── cli/
│   ├── core/
│   ├── llm/
│   ├── recorders/
│   ├── analyzers/
│   ├── store/
│   ├── reporter/
│   ├── emitter-playwright/
│   ├── config/
│   └── types/
├── examples/
│   └── nextjs-demo/            # a tiny Next.js app to point Lookout at for self-testing
├── docs/                       # docusaurus site, v1.0 only
├── .gitignore
├── .npmrc                      # shamefully-hoist=false
├── .node-version               # 20.11.0
├── package.json                # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js            # flat config
├── vitest.workspace.ts
├── LICENSE                     # MIT
└── README.md
```

## Language & tooling

- **TypeScript 5.x**, strict mode, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- **Node 20+** only. Document this in `engines`.
- **pnpm 9.x** as package manager. No npm, no yarn. `packageManager` field pinned.
- **tsup** for building each package. Produces both ESM and CJS, plus `.d.ts`.
- **Vitest** for tests. No Jest.
- **ESLint flat config** + **Prettier** via `eslint-config-prettier`.
- **Playwright** for browser automation. Only dependency for `@lookout/core`'s browser layer.
- **better-sqlite3** for storage. Synchronous API, fast, no server.
- **Zod** for all runtime validation (config, LLM action outputs, emitted types).
- **commander** for CLI argument parsing.
- **chalk** + **ora** for CLI UX (spinners, colors).

## Forbidden

- **No Axios.** Use native `fetch`.
- **No Lodash.** Native JS is enough.
- **No Moment/dayjs.** Use native `Date` + `Intl.DateTimeFormat`.
- **No CommonJS in new code.** All packages are ESM-first. CJS output is built, not authored.
- **No `any`** without an `// @ts-expect-error: <reason>` escape hatch. Review in PR.
- **No non-null assertions (`!`) without a comment.** Prefer `throw` or narrowing.
- **No `console.log` in shipped code.** Use `@lookout/core`'s logger (pino-based).
- **No global state** outside of the CLI entry. Every module must be constructible.
- **No OrionsLock or Pulse references** anywhere in source, config, env vars, docs, or package names. Single exception: the README footer attribution line. Nothing else.
- **No telemetry, analytics, phone-home.** Lookout never makes a network call to anything other than (a) the browser targets configured by the user, and (b) the LLM provider configured by the user.

## Naming

- Package names: `@lookout/<kebab-case>`
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` only if React ever enters (it won't in v1.0).
- Types: `PascalCase`. Prefix interfaces only if they represent a contract with multiple implementations (`IStore`, `ILLMClient`), otherwise plain `type` aliases.
- Functions: `camelCase`, verbs. Pure functions favored.
- Constants: `SCREAMING_SNAKE_CASE` only for true module-level constants.
- CLI commands: single-word lowercase (`run`, `init`, `report`, `baseline`, `ci`). Subcommands are space-separated (`lookout baseline promote`).

## Error handling

- All async operations return `Promise<Result<T, E>>` at package boundaries, where `Result` is a discriminated union:
  ```ts
  export type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E };
  ```
- Never `throw` across a package boundary. Convert to `Result` at the edge.
- Within a package, throwing is fine for programmer errors; use the result type for recoverable failures.
- Every recoverable error has a typed discriminant. Example:
  ```ts
  type LLMError =
    | { kind: "rate_limit"; retryAfterMs: number }
    | { kind: "auth"; message: string }
    | { kind: "invalid_response"; raw: string }
    | { kind: "network"; cause: unknown };
  ```

## Logging

- `@lookout/core` exports a `createLogger(name)` function (pino under the hood).
- CLI sets log level from `--verbose` / `--quiet` / `LOOKOUT_LOG_LEVEL`.
- Never log user LLM prompts or responses by default — they may contain credentials. Only at `trace` level with an explicit opt-in.
- Never log screenshots as base64 anywhere.

## Testing

- Every public function has at least one unit test.
- Every package has an `integration/` folder for cross-module tests.
- `@lookout/core` and `@lookout/cli` have an `e2e/` folder that spins up a local fixture app (see `examples/nextjs-demo/`) and runs a real crawl.
- Tests use the fixture app, never the public internet.
- LLM calls in tests are **always mocked**. There is a shared `@lookout/llm` mock harness.
- Vitest config sets `pool: "forks"` because Playwright does not play well with worker threads.

## Commit & PR conventions

- Conventional Commits: `feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, `docs(scope): ...`, `chore(scope): ...`, `refactor(scope): ...`, `perf(scope): ...`.
- Scope is the package name without the `@lookout/` prefix (`core`, `cli`, `llm`, etc.), or `repo` for root-level changes.
- One logical change per commit. If you did multiple things, split them.
- Every PR has a changeset (`pnpm changeset`) unless it's purely docs or chores.

## Security & safety

- **No file system writes outside** `.lookout/`, the configured `emitters.playwright.outDir`, and tempdirs.
- **No arbitrary URL navigation.** Explorer navigates only within `baseUrl`'s origin unless the config explicitly allows external origins (not in v1.0 scope).
- **Secrets only via env.** Config files may reference `process.env.FOO` but must never contain secrets inline. Lint rule enforced.
- **Auth storage state files** go in `.lookout/auth/` and are gitignored by default. The `lookout init` command writes the `.gitignore` entry.

## Documentation

- Every package has a `README.md` with: what it does, install command, a 10-line usage example, a link back to the monorepo root.
- Every exported function has a TSDoc block with at least `@param` and `@returns`.
- No README emoji avalanches. One badge row max (build status, npm version, license). Tone: professional, concise, no marketing language.

## Performance guardrails

- One run of the v0.1 demo (5 goals, 20 steps avg) should complete in under 4 minutes on a laptop with decent broadband.
- The HTML report should open in under 500ms even with 100 steps of screenshots (use lazy loading, not all inline base64).
- Startup latency of `lookout --help` should be under 200ms. No top-level imports of heavy deps (Playwright, better-sqlite3) in the CLI entry; use dynamic `import()` inside command handlers.

---

Next: read `docs/PHASES.md`.
