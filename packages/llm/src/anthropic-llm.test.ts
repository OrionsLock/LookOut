import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAnthropicLlm } from "./anthropic-llm.js";
import { PerMinuteLimiter } from "./rate-limit.js";

describe("createAnthropicLlm (mocked client)", () => {
  it("parses a valid action response", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: '{"kind":"complete","reason":"done"}' }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const llm = createAnthropicLlm(
      {
        provider: "anthropic",
        model: "claude",
        apiKey: "k",
        vision: false,
        maxTokens: 256,
      },
      { client, limiter: new PerMinuteLimiter(9999) },
    );
    const res = await llm.planAction({
      goal: "g",
      stepHistory: [],
      perception: {
        url: "http://localhost/",
        title: "t",
        a11yTree: { url: "http://localhost/", title: "t", root: { role: "generic", name: "root" } },
        screenshotPng: Buffer.alloc(0),
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.kind).toBe("complete");
  });
});
