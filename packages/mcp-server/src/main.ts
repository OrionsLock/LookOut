#!/usr/bin/env node
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildRunExportBundle, createStore, diffIssuesByFingerprint } from "@lookout/store";

const server = new Server({ name: "lookout-mcp", version: "0.5.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "lookout_list_runs",
      description: "List recent Lookout runs from a project's .lookout store",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string", description: "Project root containing .lookout/" },
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
          cwd: { type: "string" },
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
          cwd: { type: "string" },
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
          cwd: { type: "string" },
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = toolArgs(args);

  if (name === "lookout_list_runs") {
    const cwd = pickString(a, "cwd");
    const limit = typeof a.limit === "number" ? a.limit : 10;
    const store = createStore(path.join(cwd, ".lookout"));
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
    const cwd = pickString(a, "cwd");
    const runId = pickString(a, "runId");
    const store = createStore(path.join(cwd, ".lookout"));
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
    const cwd = pickString(a, "cwd");
    const runIdA = pickString(a, "runIdA");
    const runIdB = pickString(a, "runIdB");
    const store = createStore(path.join(cwd, ".lookout"));
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
    const cwd = pickString(a, "cwd");
    const runId = pickString(a, "runId");
    const storeRoot = path.join(cwd, ".lookout");
    const store = createStore(storeRoot);
    try {
      const init = await store.init();
      if (!init.ok) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: init.error }) }] };
      }
      const bundle = await buildRunExportBundle(store, storeRoot, cwd, runId);
      if (!bundle) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "run_not_found" }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, bundle }, null, 2) }] };
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
