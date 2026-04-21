import Anthropic from "@anthropic-ai/sdk";
import { err, ok, type Action, type Result } from "@lookout/types";
import { PLAN_SYSTEM_PROMPT } from "./plan-prompt.js";
import { UX_RUBRIC_SYSTEM_PROMPT } from "./ux-rubric-prompt.js";
import { summarizeA11yTree } from "./summarize-a11y-tree.js";
import { parseModelJsonToAction, type LLMError } from "./json-action.js";
import { PerMinuteLimiter } from "./rate-limit.js";
import type { LLMClient, LLMConfig, UXScoreInput } from "./types.js";
import type { PlanInput } from "./plan-types.js";
import { UXScoreSchema, type UXScore } from "./ux-score.js";

function buildUserTurn(input: PlanInput): string {
  const history =
    input.stepHistory.length === 0
      ? "(none)"
      : input.stepHistory
          .map((s, i) => `${i + 1}. ${JSON.stringify(s.action)} -> ${s.verdict}`)
          .join("\n");
  const tree = summarizeA11yTree(input.perception.a11yTree);
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
    "Screenshot attached.",
  ].join("\n");
}

/**
 * Parse a `Retry-After` header per RFC 7231. It can be either delta-seconds
 * ("120") or an HTTP-date ("Wed, 21 Oct 2015 07:28:00 GMT"). Returns a value
 * in milliseconds or `null` when the value is absent/unparseable.
 */
export function parseRetryAfterMs(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // Delta-seconds path — fractional seconds are not spec-legal but we accept them.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const secs = Number(trimmed);
    if (!Number.isFinite(secs) || secs < 0) return null;
    return Math.round(secs * 1000);
  }
  // HTTP-date path — let Date parse RFC 1123 / ISO forms.
  const t = Date.parse(trimmed);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, t - now);
}

function mapAnthropicError(e: unknown): LLMError {
  if (e && typeof e === "object" && "status" in e) {
    const status = (e as { status?: number }).status;
    if (status === 429) {
      let retryAfterMs: number | null = null;
      if ("headers" in e && e.headers && typeof (e.headers as Headers).get === "function") {
        retryAfterMs = parseRetryAfterMs((e.headers as Headers).get("retry-after"));
      }
      return { kind: "rate_limit", retryAfterMs: retryAfterMs ?? 5000 };
    }
    if (status === 401) return { kind: "auth", message: "unauthorized" };
  }
  return { kind: "network", cause: e };
}

export type AnthropicLlmDeps = {
  client?: Anthropic;
  limiter?: PerMinuteLimiter;
  onUsage?: (u: { inputTokens: number; outputTokens: number }) => void;
};

export function createAnthropicLlm(cfg: LLMConfig, deps?: AnthropicLlmDeps): LLMClient {
  const limiter = deps?.limiter ?? new PerMinuteLimiter(50);
  const onUsage = deps?.onUsage;
  const client =
    deps?.client ??
    new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
    });

  async function planAction(input: PlanInput): Promise<Result<Action, LLMError>> {
    if (!cfg.apiKey) return err({ kind: "auth", message: "missing ANTHROPIC_API_KEY" });

    let lastInvalid: LLMError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await limiter.acquire();
      const suffix =
        lastInvalid?.kind === "invalid_response"
          ? `\n\nIMPORTANT: Your previous output was invalid. Return ONLY a JSON Action object that matches the schema. Issues: ${JSON.stringify(
              lastInvalid.zodIssues ?? lastInvalid.raw,
            )}`
          : "";
      const userText = `${buildUserTurn(input)}${suffix}`;
      const content: Anthropic.MessageCreateParams["messages"][number]["content"] = cfg.vision
        ? [
            { type: "text", text: userText },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: input.perception.screenshotPng.toString("base64"),
              },
            },
          ]
        : [{ type: "text", text: userText }];

      try {
        const res = await client.messages.create({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          system: PLAN_SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        });
        if (res.usage && onUsage) {
          onUsage({ inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens });
        }
        const text = res.content.find((c) => c.type === "text");
        if (!text || text.type !== "text") {
          return err({ kind: "invalid_response", raw: JSON.stringify(res.content) });
        }
        const parsed = parseModelJsonToAction(text.text);
        if (parsed.ok) return parsed;
        if (parsed.error.kind !== "invalid_response") return parsed;
        lastInvalid = parsed.error;
      } catch (e) {
        return err(mapAnthropicError(e));
      }
    }
    return err(lastInvalid ?? { kind: "invalid_response", raw: "exhausted retries" });
  }

  async function scoreUX(input: UXScoreInput): Promise<Result<UXScore, LLMError>> {
    if (!cfg.apiKey) return err({ kind: "auth", message: "missing ANTHROPIC_API_KEY" });
    await limiter.acquire();
    const userText = [
      `URL: ${input.url}`,
      "",
      "Accessibility tree summary:",
      input.a11yTreeSummary,
      "",
      "Screenshot attached.",
    ].join("\n");
    const content: Anthropic.MessageCreateParams["messages"][number]["content"] = cfg.vision
      ? [
          { type: "text", text: userText },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: input.screenshotPng.toString("base64"),
            },
          },
        ]
      : [{ type: "text", text: userText }];

    let lastIssues: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      await limiter.acquire();
      try {
        const res = await client.messages.create({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          system: UX_RUBRIC_SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        });
        if (res.usage && onUsage) {
          onUsage({ inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens });
        }
        const text = res.content.find((c) => c.type === "text");
        if (!text || text.type !== "text") {
          return err({ kind: "invalid_response", raw: JSON.stringify(res.content) });
        }
        const raw = text.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
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
      } catch (e) {
        return err(mapAnthropicError(e));
      }
    }
    return err({ kind: "invalid_response", raw: lastIssues ?? "exhausted retries" });
  }

  return { planAction, scoreUX };
}
