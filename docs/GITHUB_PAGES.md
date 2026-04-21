# GitHub Pages — smoke `report.html` + export bundle

The workflow **[`.github/workflows/pages-smoke-artifacts.yml`](../.github/workflows/pages-smoke-artifacts.yml)** runs the **nextjs-demo** app once, then:

| Path | Contents |
|------|-----------|
| **`/examples/find-the-bug/`** | **Curated** run: mock LLM navigates to `/demo-a11y-bug` (intentional unnamed button) → axe records **a11y** issues → `report.html` + **`runs export`** bundle show a **non-trivial** agent + checks story. **Use this in README / tweets.** |
| **`/latest/`** | **CI smoke** (`lookout.smoke.json`): clean pass, good for “what CI produces,” **not** for “look what the agent found.” **Overwritten on every deploy** — treat as a moving target. |
| **`/<tag>/`** | Same smoke artifacts as **`/latest/`** for that **git tag** only — **stable permalink** for a given release (e.g. `v0.5.1/report.html`). |
| **`/index.html`** | Landing with links. |

## One-time setup

1. **Merge** the workflow to `main` (it ships with the repo).
2. **Settings → Pages** → **Build and deployment** → Source: **Deploy from a branch** → Branch **`gh-pages`** / folder **`/ (root)`** → Save.
3. **Trigger a deploy** — push a **`v*`** tag (publishes **`/<tag>/`**, **`/latest/`**, and **`/examples/find-the-bug/`**), or **Actions → “Pages — smoke report + bundle” → Run workflow** (refreshes **`/latest/`** + **`/examples/find-the-bug/`** only).

First load can take **1–10 minutes** after the workflow finishes.

## Verify Pages is wired (after you toggle Settings)

```bash
curl -sI "https://orionslock.github.io/LookOut/examples/find-the-bug/report.html" | head -n 5
```

You want **`HTTP/2 200`** (or `HTTP/1.1 200`) and a **`content-type`** that includes **`text/html`**.

- **`404`** after ~10 minutes → branch/folder in **Settings → Pages** did not stick (still **None** or wrong branch).
- **`200` but a blank page in the browser** → often **broken relative asset paths** in `report.html` (we publish the **full run directory** next to the HTML so screenshots keep working). Compare with **View Page Source** to confirm CSS/HTML arrived.

## Stable vs moving URLs (for external links)

| URL pattern | Stability |
|-------------|-----------|
| **`/v0.5.1/...`** (per **git tag**) | **Stable** for that release — safe for blog posts, HN comments, release notes. |
| **`/latest/...`** | **Moving** — always the **latest** smoke from the most recent Pages deploy. Old links keep working but **content changes**. |
| **`/examples/find-the-bug/...`** | **Curated, overwritten each deploy** — stable **path**, evolving **content** (still better than `latest/` for “show me the product”). Prefer **`/v…/`** when you need a frozen artifact pair. |

## If `github.io` is not enabled yet (sanity check)

The workflow still commits to **`gh-pages`**. Browse the tree (no Pages toggle required):

- **Curated folder:** `https://github.com/OrionsLock/LookOut/tree/gh-pages/examples/find-the-bug`

### `raw.githubusercontent.com` (escape hatch only)

Use these **only** to confirm bytes landed — **not** as primary “browse the report” links:

- `https://raw.githubusercontent.com/OrionsLock/LookOut/gh-pages/examples/find-the-bug/bundle.json` — **`text/plain`** is fine for JSON.
- `https://raw.githubusercontent.com/OrionsLock/LookOut/gh-pages/examples/find-the-bug/report.html` — GitHub serves **`.html` as `text/plain`**, so browsers show **source**, not a rendered page. Prefer the **GitHub tree** link above or **`github.io`** once Pages is on.

We intentionally **do not** use third-party HTML wrappers (e.g. htmlpreview) in docs — Pages should be the renderer.

## README links (project Pages URL)

After Pages is enabled:

- **Curated (headline):** `https://orionslock.github.io/LookOut/examples/find-the-bug/report.html` · `https://orionslock.github.io/LookOut/examples/find-the-bug/bundle.json`
- **Smoke:** `https://orionslock.github.io/LookOut/latest/report.html` · `https://orionslock.github.io/LookOut/latest/bundle.json`
- **Versioned example:** `https://orionslock.github.io/LookOut/v0.5.1/report.html`

## Custom domain (recommended for brand)

[GitHub Docs: configuring a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)

Example: **`examples.orionslock.com`** as a CNAME to **`orionslock.github.io`**, then set the custom domain under **Pages** (and optional **`CNAME`** file on `gh-pages`).

## Why bundle next to report?

`bundle.json` is **export v2**: goals, steps, issues, paths to traces/screenshots, report path. It is the portable, diff-friendly record of the run — the artifact that convinces a technical reader the system is **engineered for trust**, not only screenshots.
