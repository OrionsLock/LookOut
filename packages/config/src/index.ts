import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import { err, ok, type Result } from "@lookout/types";
import { LookoutConfigSchema, type LookoutConfigInput, type ResolvedLookoutConfig } from "./schema.js";

export type ConfigError =
  | { kind: "not_found"; searchedPaths: string[] }
  | { kind: "parse_error"; path: string; cause: unknown }
  | { kind: "validation_error"; issues: import("zod").ZodIssue[] };

export type LoadConfigOptions = {
  /**
   * Explicit config file path (absolute, or relative to `cwd`).
   * Must end with `.json`, `.ts`, `.mjs`, or `.js`.
   */
  configFile?: string;
};

/**
 * Identity helper for IDE inference of `lookout.config.ts`.
 */
export function defineConfig(config: LookoutConfigInput): LookoutConfigInput {
  return config;
}

function applyEnvOverrides(config: ResolvedLookoutConfig): ResolvedLookoutConfig {
  const next: ResolvedLookoutConfig = { ...config, llm: { ...config.llm }, auth: { ...config.auth } };

  if (process.env.LOOKOUT_LLM_PROVIDER) {
    const p = process.env.LOOKOUT_LLM_PROVIDER;
    if (p === "anthropic" || p === "openai" || p === "google" || p === "ollama" || p === "mock") {
      next.llm = { ...next.llm, provider: p };
    }
  }
  if (process.env.LOOKOUT_LLM_MODEL) {
    next.llm = { ...next.llm, model: process.env.LOOKOUT_LLM_MODEL };
  }
  if (process.env.LOOKOUT_LLM_BASE_URL) {
    next.llm = { ...next.llm, baseUrl: process.env.LOOKOUT_LLM_BASE_URL };
  }

  if (next.llm.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    next.llm = { ...next.llm, apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (next.llm.provider === "openai" && process.env.OPENAI_API_KEY) {
    next.llm = { ...next.llm, apiKey: process.env.OPENAI_API_KEY };
  }
  if (next.llm.provider === "google" && process.env.GOOGLE_API_KEY) {
    next.llm = { ...next.llm, apiKey: process.env.GOOGLE_API_KEY };
  }

  if (next.auth.type === "credentials") {
    next.auth = {
      ...next.auth,
      username: process.env.LOOKOUT_USER ?? next.auth.username,
      password: process.env.LOOKOUT_PASS ?? next.auth.password,
    };
  }

  return next;
}

function toAbsolutePaths(cwd: string, config: ResolvedLookoutConfig): ResolvedLookoutConfig {
  if (config.auth.type === "storageState") {
    return {
      ...config,
      auth: {
        ...config.auth,
        path: path.resolve(cwd, config.auth.path),
      },
    };
  }
  return config;
}

async function loadConfigFromPath(
  full: string,
  cwd: string,
): Promise<Result<ResolvedLookoutConfig, ConfigError>> {
  try {
    if (full.endsWith(".json")) {
      const raw = JSON.parse(await readFile(full, "utf8")) as unknown;
      const parsed = LookoutConfigSchema.safeParse(raw);
      if (!parsed.success) {
        return err({ kind: "validation_error", issues: parsed.error.issues });
      }
      return ok(toAbsolutePaths(cwd, applyEnvOverrides(parsed.data)));
    }

    const jiti = createJiti(full, { interopDefault: true });
    const mod = jiti(full) as { default?: unknown };
    const exported = mod.default ?? mod;
    const parsed = LookoutConfigSchema.safeParse(exported);
    if (!parsed.success) {
      return err({ kind: "validation_error", issues: parsed.error.issues });
    }
    return ok(toAbsolutePaths(cwd, applyEnvOverrides(parsed.data)));
  } catch (cause) {
    return err({ kind: "parse_error", path: full, cause });
  }
}

/**
 * Locate and load a Lookout config from disk, returning a fully resolved config.
 *
 * @param cwd - Directory to search; defaults to `process.cwd()`.
 * @param options - Optional `configFile` to load a specific file instead of default names.
 */
export async function loadConfig(
  cwd: string = process.cwd(),
  options?: LoadConfigOptions,
): Promise<Result<ResolvedLookoutConfig, ConfigError>> {
  if (options?.configFile) {
    const full = path.isAbsolute(options.configFile)
      ? options.configFile
      : path.join(cwd, options.configFile);
    const searched = [full];
    if (!existsSync(full)) {
      return err({ kind: "not_found", searchedPaths: searched });
    }
    return loadConfigFromPath(full, cwd);
  }

  const names = [
    "lookout.config.ts",
    "lookout.config.mjs",
    "lookout.config.js",
    "lookout.config.json",
  ];
  const searched: string[] = [];
  for (const name of names) {
    const full = path.join(cwd, name);
    searched.push(full);
    if (!existsSync(full)) continue;
    return loadConfigFromPath(full, cwd);
  }

  return err({ kind: "not_found", searchedPaths: searched });
}

export { LookoutConfigSchema, type LookoutConfigInput, type ResolvedLookoutConfig };
