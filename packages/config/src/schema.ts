import { z } from "zod";

const AuthSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("none"),
  }),
  z.object({
    type: z.literal("credentials"),
    // Accepts a path ("/login") or absolute URL; when absolute, the
    // orchestrator enforces that it matches the baseUrl origin so credentials
    // can't be posted to an unrelated host from config drift.
    loginUrl: z.string().min(1).max(2048),
    usernameSelector: z.string(),
    passwordSelector: z.string(),
    submitSelector: z.string(),
    successUrlPattern: z.string().max(512).optional(),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  z.object({
    type: z.literal("storageState"),
    path: z.string(),
  }),
]);

const GoalSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/, "ids must be kebab-case"),
  prompt: z.string().min(10),
});

const CrawlSchema = z.object({
  maxStepsPerGoal: z.number().int().min(1).max(200).default(30),
  maxParallelAgents: z.number().int().min(1).max(8).default(1),
  viewport: z
    .object({
      width: z.number().int().default(1440),
      height: z.number().int().default(900),
    })
    .default({ width: 1440, height: 900 }),
  goals: z.array(GoalSchema).min(1),
  exploration: z
    .object({
      enabled: z.boolean(),
      budget: z.number().int().min(1).max(200),
    })
    .optional(),
});

const ChecksSchema = z
  .object({
    a11y: z
      .object({
        enabled: z.boolean().default(true),
        failOn: z.enum(["minor", "moderate", "serious", "critical"]).default("serious"),
      })
      .default({ enabled: true, failOn: "serious" }),
    visualRegression: z
      .object({
        enabled: z.boolean().default(false),
        threshold: z.number().min(0).max(1).default(0.02),
      })
      .default({ enabled: false, threshold: 0.02 }),
    console: z
      .object({
        failOn: z.array(z.enum(["log", "info", "warn", "error"])).default(["error"]),
      })
      .default({ failOn: ["error"] }),
    network: z
      .object({
        // Cap each pattern to protect against accidental ReDoS from config —
        // typical patterns are short (e.g. "^5\d\d$"), and a 256-char ceiling
        // is generous for any realistic status-code regex.
        failOn: z.array(z.string().max(256)).max(32).default(["^5\\d\\d$", "^4\\d\\d$"]),
      })
      .default({ failOn: ["^5\\d\\d$", "^4\\d\\d$"] }),
    performance: z
      .object({
        enabled: z.boolean().default(false),
      })
      .default({ enabled: false }),
    /**
     * Controls which origins the explorer may navigate to mid-run. Defaults to
     * "same-origin" (the origin of baseUrl) to prevent an LLM-planned navigate
     * from being coerced into SSRF'ing an arbitrary target. Use "any" to opt
     * back into unrestricted navigation, or pass an explicit origin list.
     */
    navigate: z
      .object({
        allowedOrigins: z
          .union([z.literal("same-origin"), z.literal("any"), z.array(z.string().url()).max(32)])
          .default("same-origin"),
      })
      .default({ allowedOrigins: "same-origin" }),
  })
  .default({} as never);

const LLMSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google", "ollama", "mock"]).default("anthropic"),
  model: z.string().default("claude-sonnet-4-5"),
  vision: z.boolean().default(true),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  maxTokens: z.number().int().min(256).max(8192).default(2048),
});

const EmittersSchema = z
  .object({
    playwright: z
      .object({
        enabled: z.boolean().default(false),
        outDir: z.string().default("tests/lookout"),
      })
      .default({ enabled: false, outDir: "tests/lookout" }),
  })
  .default({} as never);

const ReportSchema = z
  .object({
    format: z.array(z.enum(["html", "json"])).default(["html"]),
    openAfterRun: z.boolean().default(false),
    /** Save Playwright trace zip when any goal fails or ends stuck/error. */
    traceOnFailure: z.boolean().default(false),
  })
  .default({ format: ["html"], openAfterRun: false, traceOnFailure: false });

export const LookoutConfigSchema = z.object({
  baseUrl: z.string().url(),
  auth: AuthSchema.default({ type: "none" }),
  crawl: CrawlSchema,
  checks: ChecksSchema,
  /** Omit in config files to use provider/model defaults. */
  llm: LLMSchema.default({}),
  emitters: EmittersSchema,
  report: ReportSchema,
});

export type LookoutConfigInput = z.input<typeof LookoutConfigSchema>;
export type ResolvedLookoutConfig = z.output<typeof LookoutConfigSchema>;
