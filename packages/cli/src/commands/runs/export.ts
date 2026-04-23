import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { buildRunExportBundle, createStore } from "@lookout/store";

async function cmdRunsExport(opts: { cwd: string; runId: string; out: string }) {
  const storeRoot = path.join(opts.cwd, ".lookout");
  const store = createStore(storeRoot);
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  const bundle = await buildRunExportBundle(store, storeRoot, opts.cwd, opts.runId);
  if (!bundle) {
    process.stderr.write(chalk.red("run not found\n"));
    process.exit(2);
  }
  const fs = await import("node:fs/promises");
  const outPath = path.resolve(opts.cwd, opts.out);
  await fs.writeFile(outPath, JSON.stringify(bundle, null, 2), "utf8");
  process.stdout.write(chalk.green(`wrote ${outPath}\n`));
}

export function registerRunsExportCommand(runs: Command): void {
  runs
    .command("export")
    .description(
      "Export run bundle as JSON v2 (run, goals, goalSteps, issues, report path, trace*.zip paths) for CI or sharing",
    )
    .argument("<runId>")
    .requiredOption("--out <file>", "output path (relative to cwd or absolute)")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .action(async (runId: string, o: { cwd?: string; out: string }) =>
      cmdRunsExport({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        runId,
        out: o.out,
      }),
    );
}
