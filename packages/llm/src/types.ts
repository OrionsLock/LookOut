import type { Action, Result } from "@lookout/types";
import type { PlanInput } from "./plan-types.js";
import type { LLMError } from "./json-action.js";
import type { UXScore } from "./ux-score.js";

export type { PlanInput } from "./plan-types.js";

export type UXScoreInput = {
  url: string;
  a11yTreeSummary: string;
  screenshotPng: Buffer;
};

export interface LLMClient {
  planAction(input: PlanInput): Promise<Result<Action, LLMError>>;
  scoreUX(input: UXScoreInput): Promise<Result<UXScore, LLMError>>;
}

export type LLMConfig = {
  provider: "anthropic" | "openai" | "google" | "ollama" | "mock";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  vision: boolean;
  maxTokens: number;
};

export type { UXScore } from "./ux-score.js";
export type { LLMError } from "./json-action.js";
