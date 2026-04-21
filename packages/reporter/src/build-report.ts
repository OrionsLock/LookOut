import type { ReportData } from "./types.js";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Build a self-contained HTML report string from denormalized run data.
 */
export function buildReport(data: ReportData): string {
  const duration =
    data.run.endedAt && data.run.startedAt ? `${Math.round((data.run.endedAt - data.run.startedAt) / 1000)}s` : "—";
  const llmUsage =
    data.run.summary &&
    typeof data.run.summary === "object" &&
    data.run.summary !== null &&
    "llmUsage" in data.run.summary
      ? (data.run.summary as { llmUsage: unknown }).llmUsage
      : null;
  const llmHtml =
    llmUsage !== null && typeof llmUsage === "object"
      ? `<div class="meta" style="margin-top:10px">LLM usage <pre>${esc(JSON.stringify(llmUsage, null, 2))}</pre></div>`
      : "";
  const goalsHtml = data.goals
    .map(
      (g) => `
      <section class="goal" id="goal-${esc(g.id)}">
        <h3>${esc(g.prompt)} <span class="badge">${esc(g.status)}</span></h3>
        ${g.steps
          .map(
            (s) => `
          <div class="step" id="step-${esc(s.id)}">
            <div class="meta">#${s.idx} · ${esc(s.verdict)} · ${esc(s.url)} · ${s.durationMs}ms</div>
            <pre class="action">${esc(JSON.stringify(s.action))}</pre>
            <div class="shots">
              ${
                s.screenshotBefore
                  ? `<a href="${esc(s.screenshotBefore)}"><img loading="lazy" src="${esc(s.screenshotBefore)}" alt="before"/></a>`
                  : ""
              }
              ${
                s.screenshotAfter
                  ? `<a href="${esc(s.screenshotAfter)}"><img loading="lazy" src="${esc(s.screenshotAfter)}" alt="after"/></a>`
                  : ""
              }
            </div>
          </div>`,
          )
          .join("")}
      </section>`,
    )
    .join("");

  const issuesHtml = data.issues
    .map(
      (i) => `
      <div class="issue sev-${esc(i.severity)}" id="issue-${esc(i.id)}">
        <span class="badge">${esc(i.severity)}</span>
        <span class="badge">${esc(i.category)}</span>
        <strong>${esc(i.title)}</strong>
        <pre>${esc(JSON.stringify(i.detail, null, 2))}</pre>
      </div>`,
    )
    .join("");

  const pagesHtml = data.pages
    .map(
      (p) => `
      <div class="page">
        <div><a href="#step-${esc(p.firstStepId)}">${esc(p.url)}</a> · visits ${p.visits}</div>
      </div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Lookout run ${esc(data.run.id)}</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:#0b1020;color:#e7ecff}
    header{padding:20px 24px;background:#121a33;border-bottom:1px solid #223055}
    .tabs{display:flex;gap:8px;padding:12px 24px;background:#0f1730}
    .tab{padding:8px 12px;border-radius:8px;cursor:pointer;background:#1a2548;color:#bcd}
    .tab.active{background:#2c6bff;color:white}
    .panel{display:none;padding:20px 24px}
    .panel.active{display:block}
    .goal{margin:16px 0;padding:12px;border:1px solid #223055;border-radius:12px;background:#0f1730}
    .step{margin:12px 0;padding:12px;border:1px solid #2a355f;border-radius:10px}
    .meta{opacity:.75;font-size:12px;margin-bottom:6px}
    .shots{display:flex;gap:10px;flex-wrap:wrap}
    img{max-width:420px;border-radius:8px;border:1px solid #2a355f}
    pre{white-space:pre-wrap;background:#0b1228;padding:10px;border-radius:8px;border:1px solid #223055}
    .badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#223055;margin-right:6px;font-size:12px}
    .issue{margin:10px 0;padding:12px;border-radius:10px;border:1px solid #2a355f}
    .sev-critical{border-color:#ff4d6d}
    .sev-major{border-color:#ffb020}
  </style>
</head>
<body>
  <header>
    <h1>Lookout</h1>
    <div>Run <code>${esc(data.run.id)}</code> · ${esc(data.run.baseUrl)} · ${esc(data.run.verdict)} · ${duration}</div>
    ${llmHtml}
  </header>
  <div class="tabs" role="tablist">
    <div class="tab active" data-tab="timeline">Timeline</div>
    <div class="tab" data-tab="issues">Issues</div>
    <div class="tab" data-tab="pages">Pages</div>
    <div class="tab" data-tab="visual">Visual Diff</div>
    <div class="tab" data-tab="ux">UX Audit</div>
  </div>
  <div id="timeline" class="panel active">${goalsHtml}</div>
  <div id="issues" class="panel">${issuesHtml}</div>
  <div id="pages" class="panel">${pagesHtml || "<p>No pages indexed.</p>"}</div>
  <div id="visual" class="panel">${buildVisualTab(data)}</div>
  <div id="ux" class="panel">${buildUxTab(data)}</div>
  <script>
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
        t.classList.add("active");
        const id = t.dataset.tab;
        if (!id) return;
        document.getElementById(id)?.classList.add("active");
      });
    });
  </script>
</body>
</html>`;
}

function buildVisualTab(data: ReportData): string {
  const rows = data.pages.filter((p) => p.visualDiff);
  if (!rows.length) return "<p>No visual diffs for this run.</p>";
  return rows
    .map(
      (p) => `
      <div class="issue">
        <div><strong>${esc(p.url)}</strong></div>
        ${
          p.visualDiff?.diffImagePath
            ? `<img loading="lazy" src="${esc(p.visualDiff.diffImagePath)}" alt="diff"/>`
            : ""
        }
        <div class="meta">diffRatio: ${p.visualDiff?.diffRatio ?? "—"}</div>
      </div>`,
    )
    .join("");
}

function buildUxTab(data: ReportData): string {
  const rows = data.pages.filter((p) => p.uxAudit);
  if (!rows.length) return "<p>No UX audit data for this run.</p>";
  return rows
    .map((p) => {
      const u = p.uxAudit!;
      return `<div class="goal">
        <h3>${esc(p.url)}</h3>
        <pre>${esc(JSON.stringify(u.scores, null, 2))}</pre>
        <ul>${u.concerns.map((c) => `<li><span class="badge">${esc(c.severity)}</span> ${esc(c.title)} — ${esc(c.detail)}</li>`).join("")}</ul>
      </div>`;
    })
    .join("");
}
