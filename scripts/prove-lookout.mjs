/**
 * End-to-end proofs (no API keys required):
 * 1) Next.js demo + `lookout ci` + `lookout verify-run` (mock LLM judge)
 * 2) MCP stdio server + `LOOKOUT_MCP_ROOT` guard (list_runs)
 *
 * Run from repo root after `pnpm install` + `pnpm build` + `pnpm run playwright:install`:
 *   node scripts/prove-lookout.mjs
 *
 * Optional live LLM judge (uses your keys / local Ollama; may incur cost):
 *   LOOKOUT_LIVE_JUDGE=1 pnpm vitest run packages/llm/src/judge-run.live.test.ts
 */
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";

function sh(cmd, args, opts = {}) {
  execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit", shell: isWin, ...opts });
}

function waitForHttp200(url, maxSec) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else schedule();
      });
      req.on("error", () => schedule());
      req.setTimeout(2000, () => {
        req.destroy();
        schedule();
      });
    };
    const schedule = () => {
      attempt++;
      if (attempt >= maxSec) reject(new Error(`timeout waiting for ${url}`));
      else setTimeout(tryOnce, 1000);
    };
    tryOnce();
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", shell: true });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
  } catch {
    // ignore
  }
}

async function proveDemoCiVerify() {
  console.log("\n=== [1/2] Demo + lookout ci + lookout verify-run ===\n");
  sh("npx", ["--yes", "pnpm@9", "--filter", "nextjs-demo", "build"]);
  const child = spawn("npx", ["--yes", "pnpm@9", "--filter", "nextjs-demo", "start"], {
    cwd: repoRoot,
    stdio: "pipe",
    shell: isWin,
    // Non-Windows: new process group so `kill(-pid)` tears down `next` + children.
    detached: !isWin,
  });
  try {
    await waitForHttp200("http://127.0.0.1:3000/", 120);
    sh("npx", ["--yes", "pnpm@9", "exec", "lookout", "ci", "-C", "examples/nextjs-demo", "--config", "lookout.smoke.json"]);
    sh("npx", ["--yes", "pnpm@9", "exec", "lookout", "verify-run", "-C", "examples/nextjs-demo", "--config", "lookout.smoke.json", "--json"]);
    console.log("\n[1/2] OK: ci + verify-run completed (mock judge).\n");
  } finally {
    killTree(child.pid);
  }
}

async function proveMcpStdio() {
  console.log("\n=== [2/2] MCP stdio + LOOKOUT_MCP_ROOT ===\n");
  const sdkClient = path.join(
    repoRoot,
    "packages",
    "mcp-server",
    "node_modules",
    "@modelcontextprotocol",
    "sdk",
    "dist",
    "esm",
    "client",
    "index.js",
  );
  const sdkStdio = path.join(
    repoRoot,
    "packages",
    "mcp-server",
    "node_modules",
    "@modelcontextprotocol",
    "sdk",
    "dist",
    "esm",
    "client",
    "stdio.js",
  );
  const serverJs = path.join(repoRoot, "packages", "mcp-server", "dist", "main.js");
  const { Client } = await import(pathToFileURL(sdkClient).href);
  const { StdioClientTransport } = await import(pathToFileURL(sdkStdio).href);
  const outside = path.resolve(repoRoot, "..");

  function parseFirstText(result) {
    const block = result?.content?.[0];
    if (!block || block.type !== "text") throw new Error("unexpected MCP tool result");
    return JSON.parse(block.text);
  }

  async function withClient(envExtra, fn) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverJs],
      env: { ...process.env, ...envExtra },
    });
    const client = new Client({ name: "prove-lookout", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      await fn(client);
    } finally {
      await transport.close();
    }
  }

  await withClient({ LOOKOUT_MCP_ROOT: repoRoot }, async (client) => {
    const inside = await client.callTool({
      name: "lookout_list_runs",
      arguments: { cwd: repoRoot, limit: 1 },
    });
    const inParsed = parseFirstText(inside);
    if (inParsed.ok === false && inParsed.error === "cwd_outside_LOOKOUT_MCP_ROOT") {
      throw new Error("unexpected: repo cwd should be inside LOOKOUT_MCP_ROOT");
    }
    const blocked = await client.callTool({
      name: "lookout_list_runs",
      arguments: { cwd: outside, limit: 1 },
    });
    const b = parseFirstText(blocked);
    if (b.error !== "cwd_outside_LOOKOUT_MCP_ROOT") {
      throw new Error(`expected cwd_outside_LOOKOUT_MCP_ROOT, got ${JSON.stringify(b)}`);
    }
  });

  await withClient({}, async (client) => {
    const noGuard = await client.callTool({
      name: "lookout_list_runs",
      arguments: { cwd: outside, limit: 1 },
    });
    const ng = parseFirstText(noGuard);
    if (ng.ok === false && ng.error === "cwd_outside_LOOKOUT_MCP_ROOT") {
      throw new Error("without LOOKOUT_MCP_ROOT, outside cwd should not hit root guard");
    }
  });

  console.log("\n[2/2] OK: MCP tools respond; guard blocks escape; no env = no guard.\n");
}

async function main() {
  await proveDemoCiVerify();
  await proveMcpStdio();
  console.log("All proofs passed.");
  console.log(
    "Live LLM judge (optional, uses keys / Ollama): LOOKOUT_LIVE_JUDGE=1 pnpm vitest run packages/llm/src/judge-run.live.test.ts",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
