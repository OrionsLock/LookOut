# GitHub repository metadata (high ROI)

Apply these under **Settings → General** for [github.com/OrionsLock/LookOut](https://github.com/OrionsLock/LookOut). They fix the cold sidebar (“No description, website, or topics provided”) without touching code.

## Description (single line, ~350 chars max)

```
LLM-guided browser QA: autonomous Playwright exploration, HTML reports + traces, MCP tools for your editor, CI with flake signals, and an LLM verify-run gate. By OrionsLock.
```

## Website

```
https://orionslock.com
```

## Topics (suggested)

Add any subset that fits; GitHub allows up to 20 topics.

`playwright`, `e2e-testing`, `qa`, `test-automation`, `llm`, `ai-agents`, `mcp`, `model-context-protocol`, `cursor`, `ci-cd`, `typescript`, `quality-assurance`, `browser-automation`, `devtools`

## Social preview image

1. Build or use the committed asset: **`docs/assets/github-social-preview.png`** (1280×640).
2. **Settings → General → Social preview → Edit** → upload that file.

This image is what Twitter/X, Slack, and HN-style link unfurls show for the repo URL.

## First release on GitHub

The codebase is already versioned at **0.5.0** (see `CHANGELOG.md` and `packages/cli`).

```bash
git fetch origin
git tag -a v0.5.0 -m "LookOut 0.5.0 — first public GitHub release" origin/main
git push origin v0.5.0
```

Then **Releases → Draft a new release**: choose tag `v0.5.0`, title `LookOut 0.5.0`, body = copy the **0.5.0** section from `CHANGELOG.md` (first ~10 bullets are enough).

Even a minimal release with three bullets signals “maintained” more than an empty Releases tab.

## GitHub Pages (smoke report + bundle)

After **`gh-pages`** exists (first run of [`pages-smoke-artifacts.yml`](../.github/workflows/pages-smoke-artifacts.yml)), enable **Settings → Pages** as described in [`GITHUB_PAGES.md`](GITHUB_PAGES.md).

Optional: custom domain **`examples.orionslock.com`** → CNAME to **`orionslock.github.io`** (see that doc).
