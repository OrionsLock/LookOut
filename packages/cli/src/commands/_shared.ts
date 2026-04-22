import chalk from "chalk";
import type { ResolvedLookoutConfig } from "@lookout/config";
import { createClient, type LLMClient, type LLMConfig } from "@lookout/llm";
import type { EmitSpecInput } from "@lookout/emitter-playwright";

export function emitAuthFromConfig(config: ResolvedLookoutConfig): EmitSpecInput["auth"] {
  if (config.auth.type === "credentials") {
    return {
      type: "credentials",
      loginUrl: new URL(config.auth.loginUrl, config.baseUrl).toString(),
      usernameSelector: config.auth.usernameSelector,
      passwordSelector: config.auth.passwordSelector,
      submitSelector: config.auth.submitSelector,
    };
  }
  if (config.auth.type === "storageState") {
    return { type: "storageState", storageStatePath: config.auth.path };
  }
  return { type: "none" };
}

export function llmClientConfig(llm: ResolvedLookoutConfig["llm"]): LLMConfig {
  const c: LLMConfig = {
    provider: llm.provider,
    model: llm.model,
    vision: llm.vision,
    maxTokens: llm.maxTokens,
  };
  if (llm.apiKey !== undefined) c.apiKey = llm.apiKey;
  if (llm.baseUrl !== undefined) c.baseUrl = llm.baseUrl;
  return c;
}

export type Telemetry = {
  inputTokens: number;
  outputTokens: number;
  planCalls: number;
  scoreCalls: number;
};

export function createTrackedLlm(llm: ResolvedLookoutConfig["llm"], telemetry: Telemetry): LLMClient {
  const base = createClient(llmClientConfig(llm), {
    onUsage: (u) => {
      telemetry.inputTokens += u.inputTokens;
      telemetry.outputTokens += u.outputTokens;
    },
  });
  return {
    planAction: async (input) => {
      telemetry.planCalls++;
      return base.planAction(input);
    },
    scoreUX: async (input) => {
      telemetry.scoreCalls++;
      return base.scoreUX(input);
    },
  };
}

export function formatHealMarkdown(
  runId: string,
  goals: { id: string; status: string; prompt: string }[],
  issues: { severity: string; title: string; category: string; detail: unknown }[],
): string {
  const lines = [
    `# Run ${runId}`,
    "",
    "## Goals",
    ...goals.map((g) => `- **${g.id}** (${g.status}): ${g.prompt}`),
    "",
    "## Issues",
    ...issues.map(
      (i) =>
        `- [${i.severity}/${i.category}] ${i.title}: \`${JSON.stringify(i.detail).slice(0, 500)}\``,
    ),
  ];
  return lines.join("\n");
}

const FAIL_LEVELS = ["critical", "major", "minor"] as const;
export type FailLevel = (typeof FAIL_LEVELS)[number];

export function parseFailLevel(raw: string | undefined, fallback: FailLevel = "major"): FailLevel {
  if (raw === undefined) return fallback;
  const ok = (FAIL_LEVELS as readonly string[]).includes(raw);
  if (!ok) {
    process.stderr.write(chalk.red(`invalid --fail-level: ${raw}. Use one of: ${FAIL_LEVELS.join(", ")}\n`));
    process.exit(2);
  }
  return raw as FailLevel;
}

/**
 * Decide the process exit code for a completed run.
 * - exit 2: orchestrator/goal errors (something fell over)
 * - exit 1: regressions, or any issue at-or-above `failLevel`
 * - exit 0: clean
 *
 * The severity order (most-severe → least-severe) is critical > major > minor > info,
 * and `failLevel` selects the **minimum** severity that counts as a failure.
 */
export function exitCodeFor(
  verdict: string,
  failLevel: FailLevel,
  issues: { severity: string }[],
): number {
  if (verdict === "errors") return 2;
  const severityOrder = ["critical", "major", "minor", "info"] as const;
  const failIdx = severityOrder.indexOf(failLevel);
  if (failIdx < 0) {
    // Defence in depth: parseFailLevel already rejects unknown values.
    throw new Error(`invariant_failed: unknown failLevel ${failLevel}`);
  }
  const hit = issues.some((i) => {
    const idx = severityOrder.indexOf(i.severity as (typeof severityOrder)[number]);
    return idx >= 0 && idx <= failIdx;
  });
  if (verdict === "regressions" || hit) return 1;
  return 0;
}
