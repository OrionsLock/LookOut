import { ActionSchema, ok, type Action, type Result } from "@lookout/types";
import type { LLMError } from "./json-action.js";
import type { PlanInput } from "./plan-types.js";
import type { LLMClient, UXScoreInput } from "./types.js";
import { UXScoreSchema, type UXScore } from "./ux-score.js";

const defaultUx: UXScore = {
  scores: {
    informationDensity: 3,
    ctaClarity: 3,
    copyClarity: 3,
    visualHierarchy: 3,
    cognitiveLoad: 3,
  },
  concerns: [],
};

function loadScriptFromEnv(): Action[] {
  const raw = process.env.LOOKOUT_MOCK_ACTIONS;
  if (!raw) {
    return [{ kind: "complete", reason: "mock: no LOOKOUT_MOCK_ACTIONS (immediate complete)" }];
  }
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) throw new Error("LOOKOUT_MOCK_ACTIONS must be a JSON array");
    const out: Action[] = [];
    for (const item of arr) {
      const p = ActionSchema.safeParse(item);
      if (!p.success) throw new Error(p.error.message);
      out.push(p.data);
    }
    return out;
  } catch {
    return [{ kind: "stuck", reason: "mock: invalid LOOKOUT_MOCK_ACTIONS JSON" }];
  }
}

/**
 * Deterministic LLM for CI and evals. `LOOKOUT_MOCK_ACTIONS` may be a JSON array of Action objects;
 * otherwise the client completes immediately.
 */
export function createMockLlm(script?: Action[]): LLMClient {
  const queue = [...(script ?? loadScriptFromEnv())];
  return {
    async planAction(_input: PlanInput): Promise<Result<Action, LLMError>> {
      const next = queue.shift();
      if (next) return ok(next);
      return ok({ kind: "complete", reason: "mock: script exhausted" });
    },
    async scoreUX(_input: UXScoreInput): Promise<Result<UXScore, LLMError>> {
      return ok(UXScoreSchema.parse(defaultUx));
    },
  };
}

/** Parse `LOOKOUT_MOCK_ACTIONS` for eval tests (throws on invalid JSON). */
export function parseMockActionsJson(raw: string): Action[] {
  const arr = JSON.parse(raw) as unknown;
  if (!Array.isArray(arr)) throw new Error("expected array");
  return arr.map((item) => ActionSchema.parse(item));
}
