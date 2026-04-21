import type { z } from "zod";
import { ActionSchema, err, ok, type Action, type Result } from "@lookout/types";

export type LLMError =
  | { kind: "rate_limit"; retryAfterMs: number }
  | { kind: "auth"; message: string }
  | { kind: "invalid_response"; raw: string; zodIssues?: z.ZodIssue[] }
  | { kind: "network"; cause: unknown };

export function parseModelJsonToAction(raw: string): Result<Action, LLMError> {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return err({ kind: "invalid_response", raw: text });
  }
  const safe = ActionSchema.safeParse(parsed);
  if (!safe.success) {
    return err({ kind: "invalid_response", raw: text, zodIssues: safe.error.issues });
  }
  return ok(safe.data);
}
