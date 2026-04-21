import pino, { type Logger } from "pino";

export type LogOptions = {
  level?: string;
  json?: boolean;
};

/**
 * Create a structured logger for Lookout components.
 */
export function createLogger(name: string, opts?: LogOptions): Logger {
  const level = opts?.level ?? process.env.LOOKOUT_LOG_LEVEL ?? "info";
  if (opts?.json) {
    return pino({ name, level });
  }
  return pino({
    name,
    level,
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard" },
    },
  });
}
