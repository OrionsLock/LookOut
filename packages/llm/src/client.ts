import { createAnthropicLlm } from "./anthropic-llm.js";
import { createOpenAiLlm } from "./openai-llm.js";
import { createOllamaLlm } from "./ollama-llm.js";
import { createGoogleLlm } from "./google-llm.js";
import { createMockLlm } from "./mock-llm.js";
import type { LLMClient, LLMConfig } from "./types.js";

export type CreateClientOptions = {
  /** Fired after each successful LLM round-trip that exposes usage (Anthropic, OpenAI, Google). */
  onUsage?: (u: { inputTokens: number; outputTokens: number; provider: string }) => void;
};

/**
 * Instantiate the configured LLM adapter.
 */
export function createClient(config: LLMConfig, options?: CreateClientOptions): LLMClient {
  const parentOnUsage = options?.onUsage;

  switch (config.provider) {
    case "anthropic":
      return createAnthropicLlm(
        config,
        parentOnUsage
          ? {
              onUsage: (u) => parentOnUsage({ ...u, provider: "anthropic" }),
            }
          : undefined,
      );
    case "openai":
      return createOpenAiLlm(
        config,
        parentOnUsage
          ? {
              onUsage: (u) => parentOnUsage({ ...u, provider: "openai" }),
            }
          : undefined,
      );
    case "ollama":
      return createOllamaLlm(config);
    case "google":
      return createGoogleLlm(
        config,
        parentOnUsage
          ? {
              onUsage: (u) => parentOnUsage({ ...u, provider: "google" }),
            }
          : undefined,
      );
    case "mock":
      return createMockLlm();
  }
}
