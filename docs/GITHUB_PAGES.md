# GitHub Pages — smoke `report.html` + export bundle

The workflow **[`.github/workflows/pages-smoke-artifacts.yml`](../.github/workflows/pages-smoke-artifacts.yml)** runs the same **mock LLM + nextjs-demo** smoke as CI, then publishes:

| Path | Contents |
|------|-----------|
| **`/index.html`** | Landing page with links |
| **`/latest/report.html`** (+ siblings under `latest/`) | Full run directory so relative screenshot paths keep working |
| **`/latest/bundle.json`** | **`runs export`** bundle v2 (portable, diff-friendly record of the run) |
| **`/<tag>/...`** | Same layout for each **git tag** `v*` (immutable); `latest/` is refreshed on each tag push |

## One-time setup

1. **Merge** the workflow to `main` (it ships with the repo).
2. **Settings → Pages** → **Build and deployment** → Source: **Deploy from a branch** → Branch **`gh-pages`** / folder **`/ (root)`** → Save.
3. **Trigger a deploy**
   - **Option A:** Push a version tag (`git push origin v0.5.1`), or  
   - **Option B:** **Actions → “Pages — smoke report + bundle” → Run workflow** (manual run publishes **`/latest/`** only).

First load can take a minute after the workflow finishes.

## README links (project Pages URL)

Default GitHub project URL:

- **Landing:** `https://orionslock.github.io/LookOut/`
- **Latest report:** `https://orionslock.github.io/LookOut/latest/report.html`
- **Latest bundle:** `https://orionslock.github.io/LookOut/latest/bundle.json`
- **Versioned:** `https://orionslock.github.io/LookOut/v0.5.0/report.html` (example)

## Custom domain (recommended for brand)

[GitHub Docs: configuring a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)

Example: **`examples.orionslock.com`** as a CNAME to **`orionslock.github.io`**, with a **`CNAME`** file on the `gh-pages` branch containing `examples.orionslock.com` (or use the Pages UI “Custom domain” which writes DNS hints).

That sits cleanly beside other OrionsLock surfaces (e.g. Pulse) without extra app hosting — **static HTML + JSON only**, no Vercel/Worker deploy pipeline for this artifact.

## Why bundle next to report?

`bundle.json` is the **export v2** artifact: goals, steps, issues, paths to traces/screenshots, and report location. Linking it next to the HTML report signals “trust and inspection,” not just a pretty demo page.
