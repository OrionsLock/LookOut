import OpenAI from "openai";
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

function mapOpenAIError(e: unknown): LLMError {
  if (e && typeof e === "object" && "status" in e) {
    const status = (e as { status?: number }).status;
    if (status === 429) return { kind: "rate_limit", retryAfterMs: 5000 };
    if (status === 401) return { kind: "auth", message: "unauthorized" };
  }
  return { kind: "network", cause: e };
}

export type OpenAiLlmDeps = {
  client?: OpenAI;
  limiter?: PerMinuteLimiter;
  onUsage?: (u: { inputTokens: number; outputTokens: number }) => void;
};

export function createOpenAiLlm(cfg: LLMConfig, deps?: OpenAiLlmDeps): LLMClient {
  const limiter = deps?.limiter ?? new PerMinuteLimiter(60);
  const onUsage = deps?.onUsage;
  const client =
    deps?.client ??
    new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
    });

  async function planAction(input: PlanInput): Promise<Result<Action, LLMError>> {
    if (!cfg.apiKey) return err({ kind: "auth", message: "missing OPENAI_API_KEY" });

    let lastInvalid: LLMError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await limiter.acquire();
      const suffix =
        lastInvalid?.kind === "invalid_response"
          ? `\n\nIMPORTANT: Your previous output was invalid. Return ONLY JSON Action. Issues: ${JSON.stringify(
              lastInvalid.zodIssues ?? lastInvalid.raw,
            )}`
          : "";
      const userText = `${buildUserTurn(input)}${suffix}`;

      const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = cfg.vision
        ? [
            { type: "text", text: userText },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${input.perception.screenshotPng.toString("base64")}`,
              },
            },
          ]
        : [{ type: "text", text: userText }];

      try {
        const res = await client.chat.completions.create({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          messages: [
            { role: "system", content: PLAN_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        });
        if (res.usage && onUsage) {
          onUsage({
            inputTokens: res.usage.prompt_tokens ?? 0,
            outputTokens: res.usage.completion_tokens ?? 0,
          });
        }
        const text = res.choices[0]?.message?.content ?? "";
        const parsed = parseModelJsonToAction(text);
        if (parsed.ok) return parsed;
        if (parsed.error.kind !== "invalid_response") return parsed;
        lastInvalid = parsed.error;
      } catch (e) {
        return err(mapOpenAIError(e));
      }
    }
    return err(lastInvalid ?? { kind: "invalid_response", raw: "exhausted retries" });
  }

  async function scoreUX(input: UXScoreInput): Promise<Result<UXScore, LLMError>> {
    if (!cfg.apiKey) return err({ kind: "auth", message: "missing OPENAI_API_KEY" });
    await limiter.acquire();
    const userText = [
      `URL: ${input.url}`,
      "",
      "Accessibility tree summary:",
      input.a11yTreeSummary,
      "",
      "Screenshot attached.",
    ].join("\n");
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = cfg.vision
      ? [
          { type: "text", text: userText },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${input.screenshotPng.toString("base64")}` },
          },
        ]
      : [{ type: "text", text: userText }];

    let lastIssues: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      await limiter.acquire();
      try {
        const res = await client.chat.completions.create({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          messages: [
            { role: "system", content: UX_RUBRIC_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        });
        if (res.usage && onUsage) {
          onUsage({
            inputTokens: res.usage.prompt_tokens ?? 0,
            outputTokens: res.usage.completion_tokens ?? 0,
          });
        }
        const raw = (res.choices[0]?.message?.content ?? "").trim();
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(
            raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(),
          ) as unknown;
        } catch {
          lastIssues = "json_parse";
          continue;
        }
        const parsed = UXScoreSchema.safeParse(parsedJson);
        if (parsed.success) return ok(parsed.data);
        lastIssues = JSON.stringify(parsed.error.issues);
      } catch (e) {
        return err(mapOpenAIError(e));
      }
    }
    return err({ kind: "invalid_response", raw: lastIssues ?? "exhausted retries" });
  }

  return { planAction, scoreUX };
}
