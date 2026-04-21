import { z } from "zod";

export const TargetRefSchema = z.object({
  description: z.string().min(1),
  role: z.string().optional(),
  name: z.string().optional(),
  selectorHint: z.string().optional(),
});
export type TargetRef = z.infer<typeof TargetRefSchema>;

export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), target: TargetRefSchema, intent: z.string() }),
  z.object({ kind: z.literal("fill"), target: TargetRefSchema, value: z.string(), intent: z.string() }),
  z.object({ kind: z.literal("select"), target: TargetRefSchema, value: z.string(), intent: z.string() }),
  z.object({ kind: z.literal("navigate"), url: z.string().url(), intent: z.string() }),
  z.object({ kind: z.literal("wait"), ms: z.number().int().min(0).max(30_000), intent: z.string() }),
  z.object({ kind: z.literal("assert"), description: z.string(), expectation: z.string() }),
  z.object({ kind: z.literal("complete"), reason: z.string() }),
  z.object({ kind: z.literal("stuck"), reason: z.string() }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const VerdictSchema = z.enum(["ok", "no-op", "error", "resolution-failed"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const RunVerdictSchema = z.enum(["clean", "regressions", "errors", "running"]);
export type RunVerdict = z.infer<typeof RunVerdictSchema>;

export const GoalStatusSchema = z.enum(["pending", "running", "complete", "stuck", "error"]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const SeveritySchema = z.enum(["critical", "major", "minor", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const IssueCategorySchema = z.enum([
  "a11y",
  "console",
  "network",
  "visual",
  "flow",
  "ux",
  "perf",
]);
export type IssueCategory = z.infer<typeof IssueCategorySchema>;

export const IssueSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string().nullable(),
  severity: SeveritySchema,
  category: IssueCategorySchema,
  title: z.string(),
  detail: z.record(z.unknown()),
  createdAt: z.number().int(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const StepSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  idx: z.number().int().min(0),
  url: z.string(),
  action: ActionSchema,
  selectorResolved: z.string().nullable(),
  screenshotBefore: z.string().nullable(),
  screenshotAfter: z.string().nullable(),
  a11yTreePath: z.string().nullable(),
  verdict: VerdictSchema,
  durationMs: z.number().int().min(0),
  createdAt: z.number().int(),
});
export type Step = z.infer<typeof StepSchema>;

export const GoalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  prompt: z.string(),
  status: GoalStatusSchema,
  stepsTaken: z.number().int().min(0),
  startedAt: z.number().int().nullable(),
  endedAt: z.number().int().nullable(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const RunSchema = z.object({
  id: z.string(),
  startedAt: z.number().int(),
  endedAt: z.number().int().nullable(),
  baseUrl: z.string().url(),
  commitSha: z.string().nullable(),
  verdict: RunVerdictSchema,
  summary: z.record(z.unknown()).nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type A11yNode = {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  children?: A11yNode[];
  testId?: string;
};

export type A11ySnapshot = {
  url: string;
  title: string;
  root: A11yNode;
};
