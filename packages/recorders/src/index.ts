import axePlaywright from "@axe-core/playwright";

type AxeBuilderClass = new (opts: { page: Page }) => {
  analyze: () => Promise<{
    violations: Array<{
      id: string;
      impact?: string;
      description: string;
      help: string;
      helpUrl: string;
      nodes: Array<{ target: string[]; html: string; failureSummary?: string }>;
    }>;
  }>;
};

const AxeBuilder = axePlaywright as unknown as AxeBuilderClass;
import type { Page } from "playwright";
import type { A11ySnapshot, A11yNode } from "@lookout/types";

export interface Recorder<T> {
  readonly name: string;
  start(page: Page): Promise<void>;
  collect(): T;
  stop(): Promise<void>;
}

export type ScreenshotOpts = { fullPage?: boolean };
export interface ScreenshotRecorder extends Recorder<never> {
  capture(): Promise<Buffer>;
}

export function createScreenshotRecorder(opts?: ScreenshotOpts): ScreenshotRecorder {
  let page: Page | null = null;
  const fullPage = opts?.fullPage ?? false;
  return {
    name: "screenshot",
    async start(p: Page) {
      page = p;
    },
    collect() {
      return undefined as never;
    },
    async stop() {
      page = null;
    },
    async capture() {
      if (!page) throw new Error("screenshot_not_started");
      return await page.screenshot({ type: "png", fullPage });
    },
  };
}

export type ConsoleEntry = {
  level: "log" | "info" | "warn" | "error";
  text: string;
  url?: string;
  lineno?: number;
  colno?: number;
  at: number;
};

export interface ConsoleRecorder extends Recorder<ConsoleEntry[]> {
  name: "console";
}

export function createConsoleRecorder(): ConsoleRecorder {
  const buf: ConsoleEntry[] = [];
  let page: Page | null = null;
  const onConsole = (msg: import("playwright").ConsoleMessage) => {
    const type = msg.type();
    const level: ConsoleEntry["level"] =
      type === "warning" ? "warn" : type === "debug" ? "log" : type === "info" ? "info" : type === "error" ? "error" : "log";
    buf.push({
      level,
      text: msg.text(),
      url: msg.location().url,
      lineno: msg.location().lineNumber ?? undefined,
      colno: msg.location().columnNumber ?? undefined,
      at: Date.now(),
    });
  };
  const onPageError = (err: Error) => {
    buf.push({ level: "error", text: err.message ?? String(err), at: Date.now() });
  };
  return {
    name: "console",
    async start(p: Page) {
      page = p;
      p.on("console", onConsole);
      p.on("pageerror", onPageError);
    },
    collect() {
      const out = [...buf];
      buf.length = 0;
      return out;
    },
    async stop() {
      if (page) {
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
      }
      page = null;
    },
  };
}

export type NetworkEntry = {
  url: string;
  method: string;
  status: number | undefined;
  statusText: string | undefined;
  resourceType: string;
  durationMs: number | undefined;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string> | undefined;
  failed: boolean;
  failureText: string | undefined;
  at: number;
};

export interface NetworkRecorder extends Recorder<NetworkEntry[]> {
  name: "network";
}

export function createNetworkRecorder(): NetworkRecorder {
  const buf: NetworkEntry[] = [];

  return {
    name: "network",
    async start(p: Page) {
      p.on("request", (req) => {
        const started = Date.now();
        req.response()
          .then((res) => {
        buf.push({
          url: req.url(),
          method: req.method(),
          status: res?.status(),
          statusText: res?.statusText(),
          resourceType: req.resourceType(),
          durationMs: Date.now() - started,
          requestHeaders: req.headers(),
          responseHeaders: res ? res.headers() : undefined,
          failed: false,
          failureText: undefined,
          at: Date.now(),
        });
          })
          .catch(() => {
            buf.push({
              url: req.url(),
              method: req.method(),
              resourceType: req.resourceType(),
              requestHeaders: req.headers(),
              status: undefined,
              statusText: undefined,
              durationMs: undefined,
              responseHeaders: undefined,
              failed: true,
              failureText: "no_response",
              at: Date.now(),
            });
          });
      });
      p.on("requestfailed", (req) => {
        buf.push({
          url: req.url(),
          method: req.method(),
          resourceType: req.resourceType(),
          requestHeaders: req.headers(),
          status: undefined,
          statusText: undefined,
          durationMs: undefined,
          responseHeaders: undefined,
          failed: true,
          failureText: req.failure()?.errorText,
          at: Date.now(),
        });
      });
    },
    collect() {
      const out = [...buf];
      buf.length = 0;
      return out;
    },
    async stop() {
      /* listeners cleared with page lifecycle */
    },
  };
}

export type A11yViolation = {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical";
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{ target: string[]; html: string; failureSummary: string | undefined }>;
};

export interface A11yRecorder extends Recorder<never> {
  runOnce(page: Page): Promise<A11yViolation[]>;
  snapshotTree(page: Page): Promise<A11ySnapshot>;
}

type AXNode = {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
  children?: AXNode[];
};

function axToA11y(node: AXNode | null | undefined): A11yNode {
  const role = node?.role ?? "generic";
  const out: A11yNode = { role };
  if (node?.name) out.name = node.name;
  if (node?.value) out.value = node.value;
  if (node?.description) out.description = node.description;
  if (node?.children?.length) out.children = node.children.map((c) => axToA11y(c));
  return out;
}

function attachTestIds(root: A11yNode, testIds: Array<{ testId: string; role: string; name: string }>): void {
  const visit = (n: A11yNode) => {
    for (const t of testIds) {
      if (t.role === n.role && (n.name ?? "") === t.name) {
        n.testId = t.testId;
        break;
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
}

export function createA11yRecorder(): A11yRecorder {
  return {
    name: "a11y",
    async start(_p: Page) {
      /* runOnce / snapshotTree receive the page explicitly */
    },
    collect() {
      return undefined as never;
    },
    async stop() {
      /* no retained page state */
    },
    async runOnce(p: Page) {
      const res = await new AxeBuilder({ page: p }).analyze();
      return res.violations.map((v) => ({
        id: v.id,
        impact: (v.impact ?? "minor") as A11yViolation["impact"],
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          html: n.html,
          failureSummary: n.failureSummary,
        })),
      }));
    },
    async snapshotTree(p: Page) {
      // Playwright removed `page.accessibility`; build a coarse AX-shaped tree from the live DOM.
      const snap = await p.evaluate((): AXNode | null => {
        const roleFor = (el: Element): string => {
          const r = el.getAttribute("role");
          if (r) return r;
          const t = el.tagName.toLowerCase();
          const map: Record<string, string> = {
            a: "link",
            button: "button",
            input: "textbox",
            select: "combobox",
            textarea: "textbox",
            h1: "heading",
            h2: "heading",
            h3: "heading",
            nav: "navigation",
            main: "main",
            form: "form",
            img: "image",
            ul: "list",
            ol: "list",
            li: "listitem",
            table: "table",
            label: "label",
          };
          return map[t] ?? "generic";
        };
        const nameFor = (el: Element): string | undefined => {
          const an = el.getAttribute("aria-label");
          if (an?.trim()) return an.trim();
          const lt = el.getAttribute("aria-labelledby");
          if (lt?.trim()) return `[labelledby=${lt}]`;
          const tid = el.getAttribute("data-testid");
          if (tid?.trim()) return tid.trim();
          const ph = el.getAttribute("placeholder");
          if (ph?.trim()) return ph.trim();
          const alt = el.getAttribute("alt");
          if (alt?.trim()) return alt.trim();
          const txt = (el.textContent ?? "").trim().replace(/\s+/g, " ");
          if (txt && txt.length <= 120) return txt;
          return undefined;
        };
        const walk = (el: Element, depth: number): AXNode | null => {
          if (depth > 18) return null;
          const role = roleFor(el);
          const name = nameFor(el);
          const children: AXNode[] = [];
          for (const c of Array.from(el.children)) {
            const w = walk(c, depth + 1);
            if (w) children.push(w);
          }
          if (role === "generic" && !name && children.length === 1) return children[0] ?? null;
          if (role === "generic" && !name && children.length === 0) return null;
          const out: AXNode = { role };
          if (name) out.name = name;
          if (children.length) out.children = children;
          return out;
        };
        const body = document.body;
        if (!body) return { role: "generic", name: "(no body)" };
        return walk(body, 0) ?? { role: "generic", name: "(empty)" };
      });
      const root = axToA11y(snap);
      const testIds = await p.evaluate(() => {
        const out: Array<{ testId: string; role: string; name: string }> = [];
        for (const el of Array.from(document.querySelectorAll("[data-testid]"))) {
          const testId = el.getAttribute("data-testid") ?? "";
          const role =
            el.getAttribute("role") ??
            (el instanceof HTMLButtonElement ? "button" : el instanceof HTMLAnchorElement ? "link" : "generic");
          const name =
            el.getAttribute("aria-label") ??
            (el.textContent ?? "").trim().split("\n")[0]?.slice(0, 200) ??
            "";
          out.push({ testId, role, name });
        }
        return out;
      });
      attachTestIds(root, testIds);
      return {
        url: p.url(),
        title: await p.title(),
        root,
      };
    },
  };
}

export type PerformanceSample = {
  url: string;
  navigationTiming: {
    ttfb: number;
    domContentLoaded: number;
    load: number;
  } | null;
  paintTiming: {
    firstPaint: number | undefined;
    firstContentfulPaint: number | undefined;
  } | null;
  at: number;
};

export interface PerformanceRecorder extends Recorder<PerformanceSample[]> {
  sample(page: Page): Promise<void>;
}

export function createPerformanceRecorder(): PerformanceRecorder {
  const buf: PerformanceSample[] = [];
  return {
    name: "perf",
    async start() {},
    collect() {
      const out = [...buf];
      buf.length = 0;
      return out;
    },
    async stop() {},
    async sample(page: Page) {
      const data = await page.evaluate(() => {
        const perf = performance as unknown as {
          getEntriesByType(type: string): Array<{ name?: string; startTime?: number; responseStart?: number; domContentLoadedEventEnd?: number; loadEventEnd?: number }>;
        };
        const nav = perf.getEntriesByType("navigation")[0];
        const paints = perf.getEntriesByType("paint");
        const fp = paints.find((p) => p.name === "first-paint")?.startTime;
        const fcp = paints.find((p) => p.name === "first-contentful-paint")?.startTime;
        return {
          nav: nav
            ? {
                ttfb: nav.responseStart ?? 0,
                domContentLoaded: nav.domContentLoadedEventEnd ?? 0,
                load: nav.loadEventEnd ?? 0,
              }
            : null,
          paint:
            fp || fcp
              ? {
                  firstPaint: fp,
                  firstContentfulPaint: fcp,
                }
              : null,
        };
      });
      buf.push({
        url: page.url(),
        navigationTiming: data.nav,
        paintTiming: data.paint,
        at: Date.now(),
      });
    },
  };
}
