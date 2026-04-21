import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAnthropicLlm, parseRetryAfterMs } from "./anthropic-llm.js";
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

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs("0.5")).toBe(500);
  });

  it("parses HTTP-date against a fixed now", () => {
    const now = Date.parse("2024-01-01T00:00:00Z");
    const ms = parseRetryAfterMs("Mon, 01 Jan 2024 00:00:10 GMT", now);
    expect(ms).toBe(10_000);
  });

  it("clamps past HTTP-dates to 0", () => {
    const now = Date.parse("2024-01-01T00:00:10Z");
    expect(parseRetryAfterMs("Mon, 01 Jan 2024 00:00:00 GMT", now)).toBe(0);
  });

  it("returns null for missing/unparseable values", () => {
    expect(parseRetryAfterMs(undefined)).toBe(null);
    expect(parseRetryAfterMs(null)).toBe(null);
    expect(parseRetryAfterMs("")).toBe(null);
    expect(parseRetryAfterMs("  ")).toBe(null);
    expect(parseRetryAfterMs("notadate")).toBe(null);
  });
});
