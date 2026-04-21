import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMcpCwd } from "./resolve-mcp-cwd.js";

describe("resolveMcpCwd", () => {
  const prev = process.env.LOOKOUT_MCP_ROOT;

  afterEach(() => {
    if (prev === undefined) delete process.env.LOOKOUT_MCP_ROOT;
    else process.env.LOOKOUT_MCP_ROOT = prev;
  });

  it("rejects empty cwd", () => {
    expect(resolveMcpCwd("   ", "")).toEqual({ ok: false, error: "cwd_empty" });
  });

  it("with no guard accepts resolved cwd", () => {
    delete process.env.LOOKOUT_MCP_ROOT;
    const r = resolveMcpCwd("/some/deep/path", "");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cwd).toBe(path.resolve("/some/deep/path"));
  });

  it("with explicit root allows cwd inside root", () => {
    const root = path.join(process.cwd(), "mcp-guard-root");
    const sub = path.join(root, "my-app");
    expect(resolveMcpCwd(sub, root)).toEqual({ ok: true, cwd: path.resolve(sub) });
  });

  it("with explicit root rejects cwd outside root", () => {
    const root = path.join(process.cwd(), "mcp-guard-a");
    const outside = path.join(process.cwd(), "mcp-guard-b");
    expect(resolveMcpCwd(outside, root)).toEqual({ ok: false, error: "cwd_outside_LOOKOUT_MCP_ROOT" });
  });

  it("allows cwd equal to root", () => {
    const root = path.join(process.cwd(), "mcp-guard-eq");
    expect(resolveMcpCwd(root, root)).toEqual({ ok: true, cwd: path.resolve(root) });
  });

  it("uses LOOKOUT_MCP_ROOT from env when second arg omitted", () => {
    const root = path.join(process.cwd(), "mcp-env-guard");
    process.env.LOOKOUT_MCP_ROOT = root;
    const inside = path.join(root, "pkg");
    expect(resolveMcpCwd(inside)).toEqual({ ok: true, cwd: path.resolve(inside) });
    const outside = path.join(process.cwd(), "mcp-env-outside");
    expect(resolveMcpCwd(outside)).toEqual({ ok: false, error: "cwd_outside_LOOKOUT_MCP_ROOT" });
  });
});
