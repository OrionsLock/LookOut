import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  buildRunExportBundle,
  createStore,
  diffIssuesByFingerprint,
  type StoreWithRoot,
} from "@lookout/store";
import { resolveMcpCwd, type ResolveMcpCwdError } from "./resolve-mcp-cwd.js";

const server = new Server({ name: "lookout-mcp", version: "0.5.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "lookout_list_runs",
      description: "List recent Lookout runs from a project's .lookout store",
      inputSchema: {
        type: "object",
        properties: {
          cwd: {
            type: "string",
            description:
              "Project root containing .lookout/ (absolute or relative). If env LOOKOUT_MCP_ROOT is set, cwd must resolve under that directory.",
          },
          limit: { type: "number", description: "Max runs (default 10)" },
        },
        required: ["cwd"],
      },
    },
    {
      name: "lookout_list_issues",
      description: "List issues for a Lookout run",
      inputSchema: {
        type: "object",
        properties: {
          cwd: {
            type: "string",
            description: "Project root; optional LOOKOUT_MCP_ROOT must contain resolved cwd when set.",
          },
          runId: { type: "string" },
        },
        required: ["cwd", "runId"],
      },
    },
    {
      name: "lookout_diff_runs",
      description:
        "Compare issues between two runs (fingerprint: severity + category + title). Returns onlyInA, onlyInB, inBoth.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: {
            type: "string",
            description: "Project root; optional LOOKOUT_MCP_ROOT must contain resolved cwd when set.",
          },
          runIdA: { type: "string" },
          runIdB: { type: "string" },
        },
        required: ["cwd", "runIdA", "runIdB"],
      },
    },
    {
      name: "lookout_export_run",
      description:
        "Build the same JSON bundle as `lookout runs export` (run, goals, goalSteps, issues, trace zip paths)",
      inputSchema: {
        type: "object",
        properties: {
          cwd: {
            type: "string",
            description: "Project root; optional LOOKOUT_MCP_ROOT must contain resolved cwd when set.",
          },
          runId: { type: "string" },
        },
        required: ["cwd", "runId"],
      },
    },
  ],
}));

function toolArgs(raw: unknown): Record<string, unknown> {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

type McpTextResponse = { content: [{ type: "text"; text: string }] };

function mcpCwdErrorResponse(error: ResolveMcpCwdError): McpTextResponse {
  if (error === "cwd_empty") {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "cwd_empty" }) }] };
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: "cwd_outside_LOOKOUT_MCP_ROOT",
          detail: "Set LOOKOUT_MCP_ROOT to a single parent directory and pass cwd under it.",
        }),
      },
    ],
  };
}

function openStoreAtProjectRoot(rawCwd: string): { ok: true; store: StoreWithRoot; cwd: string } | { ok: false; response: McpTextResponse } {
  const cwdRes = resolveMcpCwd(rawCwd);
  if (!cwdRes.ok) return { ok: false, response: mcpCwdErrorResponse(cwdRes.error) };
  const store = createStore(path.join(cwdRes.cwd, ".lookout"));
  return { ok: true, store, cwd: cwdRes.cwd };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = toolArgs(args);

  if (name === "lookout_list_runs") {
    const opened = openStoreAtProjectRoot(pickString(a, "cwd"));
    if (!opened.ok) return opened.response;
    const { store } = opened;
    const limit = typeof a.limit === "number" ? a.limit : 10;
    try {
      const init = await store.init();
      if (!init.ok) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: init.error }) }] };
      }
      const runs = await store.listRuns({ limit });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, runs }, null, 2) }] };
    } finally {
      store.close();
    }
  }

  if (name === "lookout_list_issues") {
    const opened = openStoreAtProjectRoot(pickString(a, "cwd"));
    if (!opened.ok) return opened.response;
    const { store } = opened;
    const runId = pickString(a, "runId");
    try {
      const init = await store.init();
      if (!init.ok) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: init.error }) }] };
      }
      const issues = await store.listIssuesForRun(runId);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, issues }, null, 2) }] };
    } finally {
      store.close();
    }
  }

  if (name === "lookout_diff_runs") {
    const opened = openStoreAtProjectRoot(pickString(a, "cwd"));
    if (!opened.ok) return opened.response;
    const { store } = opened;
    const runIdA = pickString(a, "runIdA");
    const runIdB = pickString(a, "runIdB");
    try {
      const init = await store.init();
      if (!init.ok) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: init.error }) }] };
      }
      const [ra, rb] = await Promise.all([store.getRun(runIdA), store.getRun(runIdB)]);
      if (!ra || !rb) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "run_not_found" }) }] };
      }
      const [issuesA, issuesB] = await Promise.all([
        store.listIssuesForRun(runIdA),
        store.listIssuesForRun(runIdB),
      ]);
      const diff = diffIssuesByFingerprint(issuesA, issuesB);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                runA: { id: ra.id, verdict: ra.verdict, baseUrl: ra.baseUrl },
                runB: { id: rb.id, verdict: rb.verdict, baseUrl: rb.baseUrl },
                onlyInA: diff.onlyInA,
                onlyInB: diff.onlyInB,
                inBoth: diff.inBoth,
              },
              null,
              2,
            ),
          },
        ],
      };
    } finally {
      store.close();
    }
  }

  if (name === "lookout_export_run") {
    const opened = openStoreAtProjectRoot(pickString(a, "cwd"));
    if (!opened.ok) return opened.response;
    const { store, cwd } = opened;
    const runId = pickString(a, "runId");
    const storeRoot = path.join(cwd, ".lookout");
    // MCP responses go through the LLM tool-call stream; giant payloads
    // (many-goal runs, long a11y snapshots) can blow the client context
    // window. Cap response size and, if the serialized bundle is bigger,
    // return a pointer rather than the raw JSON. Override with
    // LOOKOUT_MCP_EXPORT_BYTES if you really need a bigger payload.
    const maxBytes = Number(process.env["LOOKOUT_MCP_EXPORT_BYTES"] ?? 512 * 1024);
    try {
      const init = await store.init();
      if (!init.ok) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: init.error }) }] };
      }
      const bundle = await buildRunExportBundle(store, storeRoot, cwd, runId);
      if (!bundle) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "run_not_found" }) }] };
      }
      const serialized = JSON.stringify({ ok: true, bundle }, null, 2);
      const size = Buffer.byteLength(serialized, "utf8");
      if (Number.isFinite(maxBytes) && maxBytes > 0 && size > maxBytes) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  error: "export_too_large",
                  detail: `Bundle is ${size} bytes (limit ${maxBytes}). Run \`lookout runs export ${runId}\` to write to disk, or raise LOOKOUT_MCP_EXPORT_BYTES.`,
                  runId,
                  sizeBytes: size,
                  limitBytes: maxBytes,
                  summary: {
                    verdict: bundle.run.verdict,
                    goals: bundle.goals.length,
                    issues: bundle.issues.length,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: serialized }] };
    } finally {
      store.close();
    }
  }

  throw new Error(`unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
