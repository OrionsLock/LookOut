import { describe, expect, it, vi } from "vitest";
import { createOllamaLlm } from "./ollama-llm.js";
import { PerMinuteLimiter } from "./rate-limit.js";

describe("createOllamaLlm", () => {
  it("uses fetch and parses JSON action", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"kind":"wait","ms":1,"intent":"x"}' } }),
    });
    const llm = createOllamaLlm(
      {
        provider: "ollama",
        model: "llava",
        baseUrl: "http://localhost:11434",
        vision: false,
        maxTokens: 256,
      },
      { fetchFn: fetchFn as unknown as typeof fetch, limiter: new PerMinuteLimiter(9999) },
    );
    const res = await llm.planAction({
      goal: "12345678901",
      stepHistory: [],
      perception: {
        url: "http://localhost/",
        title: "t",
        a11yTree: { url: "http://localhost/", title: "t", root: { role: "generic", name: "root" } },
        screenshotPng: Buffer.alloc(0),
      },
    });
    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalled();
  });
});
