import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { err, ok, type Result } from "@lookout/types";
import type { LLMError } from "./json-action.js";
import type { LLMConfig } from "./types.js";

const HEAL_SYSTEM = `You are a senior QA automation engineer. Given Lookout run issues and steps (markdown), suggest concrete fixes: Playwright selectors, auth timing, Lookout config, or test data. Output markdown with headings ## Summary, ## Likely causes, ## Recommended changes. Be concise.`;

/**
 * One-shot markdown advice from the configured provider (not the action-planning schema).
 */
export async function suggestHealingMarkdown(
  cfg: LLMConfig,
  markdown: string,
): Promise<Result<string, LLMError>> {
  if (cfg.provider === "mock") {
    return ok("## Summary\n\n(mock provider — no model suggestions)\n");
  }
  try {
    if (cfg.provider === "anthropic" && cfg.apiKey) {
      const a = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
      const res = await a.messages.create({
        model: cfg.model,
        max_tokens: 2048,
        system: HEAL_SYSTEM,
        messages: [{ role: "user", content: markdown }],
      });
      const text = res.content.find((c) => c.type === "text");
      if (!text || text.type !== "text") {
        return err({ kind: "invalid_response", raw: JSON.stringify(res.content) });
      }
      return ok(text.text);
    }
    if (cfg.provider === "openai" && cfg.apiKey) {
      const o = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
      const res = await o.chat.completions.create({
        model: cfg.model,
        max_tokens: 2048,
        messages: [
          { role: "system", content: HEAL_SYSTEM },
          { role: "user", content: markdown },
        ],
      });
      return ok(res.choices[0]?.message?.content ?? "");
    }
    if (cfg.provider === "google" && cfg.apiKey) {
      const g = new GoogleGenerativeAI(cfg.apiKey);
      const model = g.getGenerativeModel({
        model: cfg.model || "gemini-2.0-flash",
        systemInstruction: HEAL_SYSTEM,
      });
      const res = await model.generateContent(markdown);
      return ok(res.response.text());
    }
    if (cfg.provider === "ollama") {
      const base = cfg.baseUrl ?? "http://127.0.0.1:11434";
      const r = await fetch(`${base.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          prompt: `${HEAL_SYSTEM}\n\n---\n\n${markdown}`,
          stream: false,
        }),
      });
      if (!r.ok) return err({ kind: "network", cause: new Error(await r.text()) });
      const j = (await r.json()) as { response?: string };
      return ok(j.response ?? "");
    }
    return err({ kind: "auth", message: "heal needs apiKey (or use mock provider)" });
  } catch (e) {
    return err({ kind: "network", cause: e });
  }
}
