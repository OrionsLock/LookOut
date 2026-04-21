import type { Page } from "playwright";
import type { StoreWithRoot } from "@lookout/store";

/**
 * Breadth-first crawl of same-origin links, recording `info` issues for each visit (and discovery).
 */
export async function recordExplorationIssues(
  page: Page,
  store: StoreWithRoot,
  runId: string,
  startUrl: string,
  budget: number,
): Promise<void> {
  let origin: string;
  try {
    origin = new URL(startUrl).origin;
  } catch {
    return;
  }

  const seen = new Set<string>();
  // Track queued URLs in a Set alongside the FIFO array so membership
  // checks are O(1) — the original `queue.includes(next)` made the whole
  // crawl O(N^2) as the discovered set grew.
  const queued = new Set<string>();
  const queue: string[] = [startUrl];
  queued.add(startUrl);

  while (queue.length > 0 && seen.size < budget) {
    const url = queue.shift();
    if (url === undefined) break;
    queued.delete(url);
    if (seen.has(url)) continue;
    seen.add(url);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch {
      await store.recordIssue({
        runId,
        stepId: null,
        severity: "info",
        category: "flow",
        title: "Exploration: navigation failed",
        detail: { url },
      });
      continue;
    }

    await store.recordIssue({
      runId,
      stepId: null,
      severity: "info",
      category: "flow",
      title: "Exploration: visited",
      detail: { url },
    });

    const anchors = await page.locator("a[href]").all();
    const hrefs: string[] = [];
    for (const loc of anchors) {
      const h = await loc.getAttribute("href");
      hrefs.push(h ?? "");
    }

    for (const h of hrefs) {
      if (seen.size + queue.length >= budget) break;
      if (!h || h.startsWith("#") || h.toLowerCase().startsWith("javascript:")) continue;
      let next: string;
      try {
        next = new URL(h, url).href;
      } catch {
        continue;
      }
      if (new URL(next).origin !== origin) continue;
      if (!seen.has(next) && !queued.has(next)) {
        queue.push(next);
        queued.add(next);
      }
    }
  }
}
