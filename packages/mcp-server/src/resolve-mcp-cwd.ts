import path from "node:path";

export type ResolveMcpCwdError = "cwd_empty" | "cwd_outside_LOOKOUT_MCP_ROOT";

export type ResolveMcpCwdResult =
  | { ok: true; cwd: string }
  | { ok: false; error: ResolveMcpCwdError };

/**
 * Resolve MCP tool `cwd` to an absolute path.
 * When `mcpRoot` is passed (including `""` to disable), it overrides `process.env.LOOKOUT_MCP_ROOT`.
 * When `mcpRoot` is omitted, reads `LOOKOUT_MCP_ROOT` from the environment.
 */
export function resolveMcpCwd(raw: string, mcpRoot?: string): ResolveMcpCwdResult {
  const t = raw.trim();
  if (!t) return { ok: false, error: "cwd_empty" };
  const resolved = path.resolve(t);
  let guard: string | undefined;
  if (mcpRoot !== undefined) {
    guard = mcpRoot.trim() || undefined;
  } else {
    guard = process.env.LOOKOUT_MCP_ROOT?.trim();
  }
  if (!guard) return { ok: true, cwd: resolved };
  const root = path.resolve(guard);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, error: "cwd_outside_LOOKOUT_MCP_ROOT" };
  }
  return { ok: true, cwd: resolved };
}
