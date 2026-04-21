import { GoogleGenerativeAI } from "@google/generative-ai";
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

function mapGeminiError(e: unknown): LLMError {
  if (e && typeof e === "object" && "status" in e) {
    const status = (e as { status?: number }).status;
    if (status === 429) return { kind: "rate_limit", retryAfterMs: 5000 };
    if (status === 401 || status === 403) return { kind: "auth", message: "unauthorized" };
  }
  return { kind: "network", cause: e };
}

export type GoogleLlmDeps = {
  client?: GoogleGenerativeAI;
  limiter?: PerMinuteLimiter;
  onUsage?: (u: { inputTokens: number; outputTokens: number }) => void;
};

export function createGoogleLlm(cfg: LLMConfig, deps?: GoogleLlmDeps): LLMClient {
  const limiter = deps?.limiter ?? new PerMinuteLimiter(60);
  const client =
    deps?.client ??
    new GoogleGenerativeAI(cfg.apiKey ?? "");

  const modelName = cfg.model || "gemini-2.0-flash";

  async function planAction(input: PlanInput): Promise<Result<Action, LLMError>> {
    if (!cfg.apiKey) return err({ kind: "auth", message: "missing GOOGLE_API_KEY" });

    let lastInvalid: LLMError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await limiter.acquire();
      const suffix =
        lastInvalid?.kind === "invalid_response"
          ? `\n\nIMPORTANT: Return ONLY a JSON Action object. Issues: ${JSON.stringify(
              lastInvalid.zodIssues ?? lastInvalid.raw,
            )}`
          : "";
      const userText = `${buildUserTurn(input)}${suffix}`;

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { text: userText },
      ];
      if (cfg.vision) {
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: input.perception.screenshotPng.toString("base64"),
          },
        });
      }

      try {
        const model = client.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: cfg.maxTokens,
            responseMimeType: "application/json",
          },
          systemInstruction: PLAN_SYSTEM_PROMPT,
        });
        const res = await model.generateContent(parts);
        const meta = res.response.usageMetadata;
        if (meta && deps?.onUsage) {
          deps.onUsage({
            inputTokens: meta.promptTokenCount ?? 0,
            outputTokens: meta.candidatesTokenCount ?? 0,
          });
        }
        const text = res.response.text();
        const parsed = parseModelJsonToAction(text);
        if (parsed.ok) return parsed;
        if (parsed.error.kind !== "invalid_response") return parsed;
        lastInvalid = parsed.error;
      } catch (e) {
        return err(mapGeminiError(e));
      }
    }
    return err(lastInvalid ?? { kind: "invalid_response", raw: "exhausted retries" });
  }

  async function scoreUX(input: UXScoreInput): Promise<Result<UXScore, LLMError>> {
    if (!cfg.apiKey) return err({ kind: "auth", message: "missing GOOGLE_API_KEY" });
    await limiter.acquire();
    const userText = [
      `URL: ${input.url}`,
      "",
      "Accessibility tree summary:",
      input.a11yTreeSummary,
      "",
      "Screenshot attached.",
    ].join("\n");

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: userText },
    ];
    if (cfg.vision) {
      parts.push({
        inlineData: { mimeType: "image/png", data: input.screenshotPng.toString("base64") },
      });
    }

    try {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: {
          maxOutputTokens: cfg.maxTokens,
          responseMimeType: "application/json",
        },
        systemInstruction: UX_RUBRIC_SYSTEM_PROMPT,
      });
      const res = await model.generateContent(parts);
      const meta = res.response.usageMetadata;
      if (meta && deps?.onUsage) {
        deps.onUsage({
          inputTokens: meta.promptTokenCount ?? 0,
          outputTokens: meta.candidatesTokenCount ?? 0,
        });
      }
      const raw = res.response.text().trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw) as unknown;
      } catch {
        return err({ kind: "invalid_response", raw });
      }
      const parsed = UXScoreSchema.safeParse(parsedJson);
      if (!parsed.success) {
        return err({ kind: "invalid_response", raw: JSON.stringify(parsed.error.issues) });
      }
      return ok(parsed.data);
    } catch (e) {
      return err(mapGeminiError(e));
    }
  }

  return { planAction, scoreUX };
}
