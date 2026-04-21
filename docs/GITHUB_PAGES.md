# GitHub Pages — operations & verification

**What lives where (curated vs smoke vs versioned):** the canonical description is the template **[`static/gh-pages-index.html`](static/gh-pages-index.html)**, copied to the site root as **`/index.html`**. The curated folder also gets **[`static/find-the-bug-index.html`](static/find-the-bug-index.html)** as **`/examples/find-the-bug/index.html`**. Prefer updating those HTML files over duplicating the same tables in Markdown — other docs should **link** here for Settings / `curl` / troubleshooting only.

The workflow **[`.github/workflows/pages-smoke-artifacts.yml`](../.github/workflows/pages-smoke-artifacts.yml)** builds **`_publish/`** and pushes to **`gh-pages`**.

## One-time setup

1. **Merge** the workflow to `main` (it ships with the repo).
2. **Settings → Pages** → **Build and deployment** → Source: **Deploy from a branch** → Branch **`gh-pages`** / folder **`/ (root)`** → Save.
3. **Trigger a deploy** — push a **`v*`** tag, or **Actions → “Pages — smoke report + bundle” → Run workflow**.

First **`github.io`** load can take **1–10 minutes** after the workflow finishes.

## Two different “green” workflows

After you enable Pages, GitHub may show **two** successful flows:

1. **Your workflow** (`Pages — smoke report + bundle`) — writes the **`gh-pages`** branch.
2. **`pages build and deployment`** (GitHub’s internal job) — actually serves **`github.io`**.

If **(1)** is green but **`github.io` still 404s** after ~10 minutes, open **(2)** in the Actions tab; first-time Pages sometimes fails there (permissions) and passes on **re-run**. Both should be green before links resolve.

## Verify after the Pages toggle

**Headers** (want **200** and **`content-type`** containing **`text/html`** for the report):

```bash
curl -sI "https://orionslock.github.io/LookOut/examples/find-the-bug/report.html" | head -n 8
```

**Bundle is real JSON with issues** (not HTML-wrapped; `issues` should be non-empty for the curated run):

```bash
curl -s "https://orionslock.github.io/LookOut/examples/find-the-bug/bundle.json" | jq '.run.id, (.issues | length)'
```

**Browser:** open **`…/examples/find-the-bug/`** ( **`index.html`** ) and **`report.html`**. Confirm assets (screenshots) load — reports use paths relative to the published run directory; we copy the **full run folder** next to `report.html` so paths keep working.

- **`404`** after ~10 minutes → **Settings → Pages** branch/folder did not stick.
- **`200` but blank** → often broken relative asset paths; compare **View Page Source**.

## If `github.io` is not enabled yet

Browse **`gh-pages`** on GitHub (no Pages toggle required):

- **Site map:** `https://github.com/OrionsLock/LookOut/blob/gh-pages/index.html` (same content as [`static/gh-pages-index.html`](static/gh-pages-index.html))
- **Curated folder:** `https://github.com/OrionsLock/LookOut/tree/gh-pages/examples/find-the-bug`

### `raw.githubusercontent.com` (bytes only)

- **`.json`** — fine; **`text/plain`** is acceptable.
- **`.html`** — served as **`text/plain`**; browsers show **source**, not a rendered page. Prefer **`github.io`** or the **GitHub tree** link above.

## Public URLs (after Pages is on)

- **Curated landing:** `https://orionslock.github.io/LookOut/examples/find-the-bug/`
- **Curated report / bundle:** `…/examples/find-the-bug/report.html` · `…/bundle.json`
- **Smoke:** `…/latest/report.html` · `…/latest/bundle.json` (**moving** — content changes each deploy)
- **Versioned smoke (stable per tag):** `…/v0.5.2/report.html` (example)

## Version numbers on Releases

Public tags already use **`0.5.x`** (pre-public iteration). We are **not** renumbering published tags; new releases continue from **`0.5.x`** unless you explicitly decide to reset marketing versioning.

## Custom domain (optional)

[GitHub Docs: configuring a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site) — e.g. **`examples.orionslock.com`** → CNAME to **`orionslock.github.io`**.

## Why `bundle.json`?

Export **v2** is the portable, diff-friendly record (goals, steps, issues, artifact paths). It is the artifact that signals **trust**, not only screenshots.
