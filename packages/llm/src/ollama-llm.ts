import { err, ok, type Action, type Result } from "@lookout/types";
import { PLAN_SYSTEM_PROMPT } from "./plan-prompt.js";
import { UX_RUBRIC_SYSTEM_PROMPT } from "./ux-rubric-prompt.js";
import { summarizeA11yTree } from "./summarize-a11y-tree.js";
import { parseModelJsonToAction, type LLMError } from "./json-action.js";
import { PerMinuteLimiter } from "./rate-limit.js";
import type { LLMClient, LLMConfig, UXScoreInput } from "./types.js";
import type { PlanInput } from "./plan-types.js";
import { UXScoreSchema, type UXScore } from "./ux-score.js";

function buildUserTurn(cfg: LLMConfig, input: PlanInput): string {
  const history =
    input.stepHistory.length === 0
      ? "(none)"
      : input.stepHistory
          .map((s, i) => `${i + 1}. ${JSON.stringify(s.action)} -> ${s.verdict}`)
          .join("\n");
  const tree = summarizeA11yTree(input.perception.a11yTree);
  const visionNote = cfg.vision ? "A screenshot is attached as a base64 image." : "";
  return [
    `Goal: ${input.goal}`,
    "",
    "Previous steps (most recent last):",
    history,
    "",
    "Current page:",
    `- URL: ${input.perception.url}`,
    `- Title: ${input.perception.title}`,
    "- Accessibility tree (abridged):",
    tree,
    "",
    visionNote,
  ].join("\n");
}

export type OllamaLlmDeps = {
  fetchFn?: typeof fetch;
  limiter?: PerMinuteLimiter;
};

export function createOllamaLlm(cfg: LLMConfig, deps?: OllamaLlmDeps): LLMClient {
  const fetchFn = deps?.fetchFn ?? globalThis.fetch.bind(globalThis);
  const limiter = deps?.limiter ?? new PerMinuteLimiter(10_000);
  const base = cfg.baseUrl ?? "http://localhost:11434";

  async function chat(
    messages: Array<{ role: string; content: string; images?: string[] }>,
  ): Promise<Result<string, LLMError>> {
    const res = await fetchFn(`${base.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
      }),
    });
    if (!res.ok) {
      if (res.status === 401) return err({ kind: "auth" as const, message: await res.text() });
      if (res.status === 429) return err({ kind: "rate_limit" as const, retryAfterMs: 5000 });
      return err({ kind: "network" as const, cause: new Error(`${res.status} ${await res.text()}`) });
    }
    const json = (await res.json()) as { message?: { content?: string } };
    const text = json.message?.content;
    if (!text) return err({ kind: "invalid_response" as const, raw: JSON.stringify(json) });
    return ok(text);
  }

  async function planAction(input: PlanInput): Promise<Result<Action, LLMError>> {
    let lastInvalid: LLMError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await limiter.acquire();
      const suffix =
        lastInvalid?.kind === "invalid_response"
          ? `\n\nIMPORTANT: Your previous output was invalid. Return ONLY JSON Action. Issues: ${JSON.stringify(
              lastInvalid.zodIssues ?? lastInvalid.raw,
            )}`
          : "";
      const userText = `${buildUserTurn(cfg, input)}${suffix}`;
      const images =
        cfg.vision && input.perception.screenshotPng.length > 0
          ? [input.perception.screenshotPng.toString("base64")]
          : undefined;
      const userMsg: { role: string; content: string; images?: string[] } = { role: "user", content: userText };
      if (images) userMsg.images = images;
      const res = await chat([{ role: "system", content: PLAN_SYSTEM_PROMPT }, userMsg]);
      if (!res.ok) return res;
      const parsed = parseModelJsonToAction(res.value);
      if (parsed.ok) return parsed;
      if (parsed.error.kind !== "invalid_response") return parsed;
      lastInvalid = parsed.error;
    }
    return err(lastInvalid ?? ({ kind: "invalid_response" as const, raw: "exhausted retries" } satisfies LLMError));
  }

  async function scoreUX(input: UXScoreInput): Promise<Result<UXScore, LLMError>> {
    let lastIssues: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      await limiter.acquire();
      const userText = [
        `URL: ${input.url}`,
        "",
        "Accessibility tree summary:",
        input.a11yTreeSummary,
        "",
        "Return ONLY JSON for UXScore schema.",
      ].join("\n");
      const images =
        cfg.vision && input.screenshotPng.length > 0 ? [input.screenshotPng.toString("base64")] : undefined;
      const userMsg: { role: string; content: string; images?: string[] } = { role: "user", content: userText };
      if (images) userMsg.images = images;
      const res = await chat([{ role: "system", content: UX_RUBRIC_SYSTEM_PROMPT }, userMsg]);
      if (!res.ok) return res;
      const raw = res.value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw) as unknown;
      } catch {
        lastIssues = "json_parse";
        continue;
      }
      const parsed = UXScoreSchema.safeParse(parsedJson);
      if (parsed.success) return ok(parsed.data);
      lastIssues = JSON.stringify(parsed.error.issues);
    }
    return err({
      kind: "invalid_response" as const,
      raw: lastIssues ?? "exhausted retries",
    } satisfies LLMError);
  }

  return { planAction, scoreUX };
}
