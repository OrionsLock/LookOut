import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { createStore } from "@lookout/store";

async function cmdRunsList(opts: { cwd: string; limit: number; json: boolean }) {
  const store = createStore(path.join(opts.cwd, ".lookout"));
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  const runs = await store.listRuns({ limit: opts.limit });
  if (opts.json) {
    process.stdout.write(JSON.stringify({ runs }, null, 2) + "\n");
    return;
  }
  if (!runs.length) {
    process.stdout.write("(no runs)\n");
    return;
  }
  for (const r of runs) {
    const sum = r.summary && typeof r.summary === "object" ? JSON.stringify(r.summary) : "";
    process.stdout.write(
      `${r.id}\t${r.verdict}\t${r.baseUrl}\tendedAt=${r.endedAt ?? "—"}\t${sum.slice(0, 120)}${sum.length > 120 ? "…" : ""}\n`,
    );
  }
}

export function registerRunsListCommand(runs: Command): void {
  runs
    .command("list")
    .description("List recent runs")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--limit <n>", "max runs", "20")
    .option("--json", "machine-readable JSON")
    .action(async (o: { cwd?: string; limit?: string; json?: boolean }) =>
      cmdRunsList({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        limit: Math.max(1, Math.min(500, Number(o.limit ?? 20) || 20)),
        json: Boolean(o.json),
      }),
    );
}
