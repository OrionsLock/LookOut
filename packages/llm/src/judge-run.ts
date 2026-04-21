import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { err, ok, type Result } from "@lookout/types";
import type { LLMError } from "./json-action.js";
import type { LLMConfig } from "./types.js";

const JUDGE_SYSTEM = `You are an independent QA judge reviewing a completed automated browser run.
You receive goals, final verdict, and a list of issues (severity, category, title, detail).
Decide whether the run should be ACCEPTED as a reasonable pass for CI (minor noise ok) or REJECTED (likely real regressions or broken flow).

Output ONLY a single JSON object (no markdown fences) with this exact shape:
{"verdict":"accept"|"reject","confidence":0,"rationale":"one short sentence"}
confidence is 0.0-1.0. Be conservative: reject if any critical/major flow or visual issue seems real.`;

export const JudgeVerdictSchema = z.object({
  verdict: z.enum(["accept", "reject"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/** Extract first balanced {...} JSON object from model text (`undefined` if none). */
export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return;
        }
      }
    }
  }
  return;
}

export function parseJudgeVerdict(raw: unknown): Result<JudgeVerdict, LLMError> {
  const p = JudgeVerdictSchema.safeParse(raw);
  if (!p.success) {
    return err({ kind: "invalid_response", raw: JSON.stringify(raw), zodIssues: p.error.issues });
  }
  return ok(p.data);
}

/**
 * Agent-as-judge: one-shot structured verdict from the configured provider (not action JSON).
 */
export async function judgeRunMarkdown(cfg: LLMConfig, markdown: string): Promise<Result<JudgeVerdict, LLMError>> {
  if (cfg.provider === "mock") {
    return ok({ verdict: "accept", confidence: 1, rationale: "mock provider — no model judge" });
  }
  try {
    let text = "";
    if (cfg.provider === "anthropic" && cfg.apiKey) {
      const a = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
      const res = await a.messages.create({
        model: cfg.model,
        max_tokens: 512,
        system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: markdown }],
      });
      const block = res.content.find((c) => c.type === "text");
      if (!block || block.type !== "text") {
        return err({ kind: "invalid_response", raw: JSON.stringify(res.content) });
      }
      text = block.text;
    } else if (cfg.provider === "openai" && cfg.apiKey) {
      const o = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
      const res = await o.chat.completions.create({
        model: cfg.model,
        max_tokens: 512,
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: markdown },
        ],
      });
      text = res.choices[0]?.message?.content ?? "";
    } else if (cfg.provider === "google" && cfg.apiKey) {
      const g = new GoogleGenerativeAI(cfg.apiKey);
      const model = g.getGenerativeModel({
        model: cfg.model || "gemini-2.0-flash",
        systemInstruction: JUDGE_SYSTEM,
      });
      const res = await model.generateContent(markdown);
      text = res.response.text();
    } else if (cfg.provider === "ollama") {
      const base = cfg.baseUrl ?? "http://127.0.0.1:11434";
      const r = await fetch(`${base.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          prompt: `${JUDGE_SYSTEM}\n\n---\n\n${markdown}`,
          stream: false,
        }),
      });
      if (!r.ok) return err({ kind: "network", cause: new Error(await r.text()) });
      const j = (await r.json()) as { response?: string };
      text = j.response ?? "";
    } else {
      return err({ kind: "auth", message: "judge needs apiKey (or use mock provider)" });
    }

    const extracted = extractFirstJsonObject(text.trim());
    if (extracted === undefined || extracted === null) {
      return err({ kind: "invalid_response", raw: text.slice(0, 2000) });
    }
    return parseJudgeVerdict(extracted);
  } catch (e) {
    return err({ kind: "network", cause: e });
  }
}
