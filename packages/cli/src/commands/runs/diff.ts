import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { createStore, diffIssuesByFingerprint } from "@lookout/store";

async function cmdRunsDiff(opts: { cwd: string; runA: string; runB: string; json: boolean }) {
  const store = createStore(path.join(opts.cwd, ".lookout"));
  const init = await store.init();
  if (!init.ok) {
    process.stderr.write(chalk.red("store init failed\n"));
    process.exit(2);
  }
  const [ra, rb] = await Promise.all([store.getRun(opts.runA), store.getRun(opts.runB)]);
  if (!ra || !rb) {
    process.stderr.write(chalk.red("run not found (check run ids)\n"));
    process.exit(2);
  }
  const [issuesA, issuesB] = await Promise.all([
    store.listIssuesForRun(opts.runA),
    store.listIssuesForRun(opts.runB),
  ]);
  const diff = diffIssuesByFingerprint(issuesA, issuesB);
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          runA: { id: ra.id, verdict: ra.verdict, baseUrl: ra.baseUrl },
          runB: { id: rb.id, verdict: rb.verdict, baseUrl: rb.baseUrl },
          onlyInA: diff.onlyInA,
          onlyInB: diff.onlyInB,
          inBoth: diff.inBoth,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  process.stdout.write(chalk.bold(`Compare ${opts.runA} (A) vs ${opts.runB} (B)\n\n`));
  process.stdout.write(chalk.yellow(`Only in A (${diff.onlyInA.length})\n`));
  for (const i of diff.onlyInA) {
    process.stdout.write(`  [${i.severity}/${i.category}] ${i.title}\n`);
  }
  process.stdout.write(chalk.yellow(`\nOnly in B (${diff.onlyInB.length})\n`));
  for (const i of diff.onlyInB) {
    process.stdout.write(`  [${i.severity}/${i.category}] ${i.title}\n`);
  }
  process.stdout.write(chalk.green(`\nIn both (${diff.inBoth.length})\n`));
  for (const i of diff.inBoth) {
    process.stdout.write(`  [${i.severity}/${i.category}] ${i.title}\n`);
  }
  process.stdout.write("\n");
}

export function registerRunsDiffCommand(runs: Command): void {
  runs
    .command("diff")
    .description("Compare issues between two run ids (fingerprint: severity + category + title)")
    .argument("<runIdA>", "first run id")
    .argument("<runIdB>", "second run id")
    .option("-C, --cwd <dir>", "project root", process.cwd())
    .option("--json", "machine-readable JSON")
    .action(async (runIdA: string, runIdB: string, o: { cwd?: string; json?: boolean }) =>
      cmdRunsDiff({
        cwd: path.resolve(o.cwd ?? process.cwd()),
        runA: runIdA,
        runB: runIdB,
        json: Boolean(o.json),
      }),
    );
}
