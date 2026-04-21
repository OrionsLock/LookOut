# Lookout

[![CI](https://github.com/OrionsLock/LookOut/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OrionsLock/LookOut/actions/workflows/ci.yml)

**Most “AI QA” demos stop at a chat box. Lookout is built for the boring part that matters in production:** autonomous browser exploration, durable artifacts, CI semantics, and editor-native tooling—so a run is something you can **diff**, **gate**, and **re-open** next week.

It exists because teams already have Playwright and LLMs, but not a single loop that (1) explores like a human, (2) **writes evidence** (HTML report, screenshots, optional traces), (3) **exports Playwright specs** from real runs, (4) exposes the same store over **MCP** to Cursor-style clients, and (5) supports a **second-pass LLM judge** (`verify-run`) and **flake-as-signal** retries in CI—not just pass/fail noise.

Open source by [OrionsLock](https://orionslock.com). **Repo checklist** (description, topics, social image, first release): [`docs/GITHUB_REPO_SETTINGS.md`](docs/GITHUB_REPO_SETTINGS.md). **Published smoke artifacts** (HTML report + export bundle on GitHub Pages): [`docs/GITHUB_PAGES.md`](docs/GITHUB_PAGES.md).

---

### What’s different (not “another Playwright wrapper”)

| Idea | What you get |
|------|----------------|
| **Agent discovers, specs remain** | Goals drive exploration; completed flows can emit **real Playwright tests** (`generate-tests`, `runs emit-playwright`). |
| **MCP-native store** | `@lookout/mcp-server` stdio tools list runs/issues, **diff runs**, **export bundles**—same semantics as the CLI. Optional **`LOOKOUT_MCP_ROOT`** sandbox for `cwd` ([`SECURITY.md`](SECURITY.md)). |
| **Verifier-in-the-loop** | After CI, **`lookout verify-run`** runs an LLM judge on the **export bundle** (`accept` / `reject`, exit codes for pipelines). |
| **Flake as signal** | **`lookout ci --retries`** with stderr JSON (`flake_suspected`, `will_retry`) and **`--strict-retry`** when you want “green only if first attempt passed.” |
| **Trust primitives** | **`runs diff`** (fingerprinted issues), **`runs export`** (bundle v2 with steps + trace paths), JUnit from CI, traces on failure. |

---

### What it looks like

Lookout’s primary surface is the **HTML report** (issues, steps, evidence paths)—not a transcript.

![Preview mockup — not a real Lookout HTML export; shows the kind of panel layout and severity styling you get in an actual `report.html`.](docs/assets/report-preview.png)

*Honest label: this asset is a **deliberate visual placeholder** (no freshness debt from checking in a generated report). Real runs write `report.html` plus screenshots under `.lookout/runs/<id>/`; run the smoke demo locally in seconds (see **Quick start**), or use the **hosted** copies once Pages is enabled (below).*

**Live artifacts (GitHub Pages)** — CI publishes the smoke run’s **`report.html`** next to the **`runs export` bundle (JSON v2)**. **Rendered site** (needs [one-time Pages setup](docs/GITHUB_PAGES.md) → branch **`gh-pages`**): [latest report](https://orionslock.github.io/LookOut/latest/report.html) · [latest bundle](https://orionslock.github.io/LookOut/latest/bundle.json). **Same files on `gh-pages` now** (works even if `github.io` still 404s): [folder](https://github.com/OrionsLock/LookOut/tree/gh-pages/latest) · [raw report](https://raw.githubusercontent.com/OrionsLock/LookOut/gh-pages/latest/report.html) · [raw bundle](https://raw.githubusercontent.com/OrionsLock/LookOut/gh-pages/latest/bundle.json).

**Moving demo (asciinema preferred):** we do **not** embed a recording yet — **asciinema** ages better than a GIF for CLI-first flows (copy-pasteable commands, smaller repo). A GIF only wins if you need to **animate the HTML report** in a browser; static layout is already the screenshot’s job.

> **Ideal capture for a contributor asciinema:** `lookout run` or `lookout ci` on **`examples/nextjs-demo`** → the agent surfaces a **real defect** (e.g. broken form) → open the generated **`report.html`** → run **`lookout runs emit-playwright <runId> --out …`** so a **`.spec.ts` lands on disk**. That sells the **agent → evidence → Playwright artifact** loop, not “here’s a terminal scrolling.” **PRs welcome** to embed the recording here.

Until a recording lands, a **one-command** local proof (Next demo + `lookout ci` + `lookout verify-run` + MCP stdio checks) is:

```bash
pnpm install && pnpm run playwright:install && pnpm build && pnpm run prove
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for CI parity details.

---

## Quick start

```bash
pnpm install
pnpm build
pnpm exec lookout --help
```

Runnable app + mock LLM smoke (no API keys):

```bash
pnpm run playwright:install
pnpm build
pnpm --filter nextjs-demo build
pnpm --filter nextjs-demo start
# other terminal:
pnpm exec lookout ci -C examples/nextjs-demo --config lookout.smoke.json
```

`lookout ci` is non-zero on regressions; add **`--junit out.xml`** for CI dashboards. After a run: **`pnpm exec lookout verify-run -C examples/nextjs-demo --config lookout.smoke.json`** (second gate; mock provider always accepts).

---

## Golden path & trust

- **Retries / flake:** `--retries`, `flake_suspected`, `--strict-retry` — full semantics in [`docs/LAUNCH_REVIEW.md`](docs/LAUNCH_REVIEW.md).
- **Compare runs:** `lookout runs list`, `runs diff`, `runs export` — fingerprinted issues, bundle v2 for sharing or automation.
- **MCP:** `pnpm exec lookout-mcp` after `pnpm build`, or `packages/mcp-server/dist/main.js` with a project that has `.lookout/`.

---

## Development

```bash
pnpm build
pnpm lint
pnpm test
pnpm run test:eval
pnpm run prove          # optional: end-to-end smoke + MCP proof
```

`pnpm build` before lint/tests so workspace `dist/*.d.ts` resolves for ESLint and Vitest.

---

## License and contributing

MIT — [`LICENSE`](LICENSE). PRs: [`CONTRIBUTING.md`](CONTRIBUTING.md). Security: [`SECURITY.md`](SECURITY.md). History: [`CHANGELOG.md`](CHANGELOG.md).

Canonical repo: [github.com/OrionsLock/LookOut](https://github.com/OrionsLock/LookOut).
