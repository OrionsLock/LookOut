/**
 * Live provider checks for `judgeRunMarkdown` (real HTTP; may cost money).
 *
 *   LOOKOUT_LIVE_JUDGE=1 pnpm vitest run packages/llm/src/judge-run.live.test.ts
 *
 * Set one or more API keys / run Ollama locally. Tests are skipped when a provider is not configured.
 */
import { describe, expect, it } from "vitest";
import { judgeRunMarkdown } from "./judge-run.js";

const live = process.env.LOOKOUT_LIVE_JUDGE === "1";

const bundleMd = [
  "# Lookout run (agent judge input)",
  "",
  "```json",
  JSON.stringify(
    {
      run: { id: "live-smoke", verdict: "clean" },
      goals: [{ id: "g1", status: "complete", prompt: "smoke" }],
      issues: [],
    },
    null,
    2,
  ),
  "```",
].join("\n");

describe.skipIf(!live)("judgeRunMarkdown live", () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY)("anthropic returns a verdict", async () => {
    const r = await judgeRunMarkdown(
      {
        provider: "anthropic",
        model: process.env.LOOKOUT_LIVE_ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022",
        apiKey: process.env.ANTHROPIC_API_KEY,
        vision: false,
        maxTokens: 512,
      },
      bundleMd,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(["accept", "reject"]).toContain(r.value.verdict);
      expect(r.value.rationale.length).toBeGreaterThan(0);
    }
  });

  it.skipIf(!process.env.OPENAI_API_KEY)("openai returns a verdict", async () => {
    const r = await judgeRunMarkdown(
      {
        provider: "openai",
        model: process.env.LOOKOUT_LIVE_OPENAI_MODEL ?? "gpt-4o-mini",
        apiKey: process.env.OPENAI_API_KEY,
        vision: false,
        maxTokens: 512,
      },
      bundleMd,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(["accept", "reject"]).toContain(r.value.verdict);
    }
  });

  it.skipIf(!process.env.GOOGLE_API_KEY)("google returns a verdict", async () => {
    const r = await judgeRunMarkdown(
      {
        provider: "google",
        model: process.env.LOOKOUT_LIVE_GOOGLE_MODEL ?? "gemini-2.0-flash",
        apiKey: process.env.GOOGLE_API_KEY,
        vision: false,
        maxTokens: 512,
      },
      bundleMd,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(["accept", "reject"]).toContain(r.value.verdict);
    }
  });

  it("ollama when /api/tags is reachable (otherwise skipped)", async () => {
    const base = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
    const tags = await fetch(`${base.replace(/\/$/, "")}/api/tags`).catch(() => null);
    if (!tags?.ok) {
      console.warn("[judge-run live] Ollama not reachable; skipping ollama assertion");
      expect(true).toBe(true);
      return;
    }
    const j = (await tags.json()) as { models?: { name: string }[] };
    const model = j.models?.[0]?.name;
    if (!model) {
      console.warn("[judge-run live] Ollama has no models; skipping");
      expect(true).toBe(true);
      return;
    }
    const r = await judgeRunMarkdown(
      {
        provider: "ollama",
        model,
        baseUrl: base,
        vision: false,
        maxTokens: 512,
      },
      bundleMd,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(["accept", "reject"]).toContain(r.value.verdict);
    }
  });
});
