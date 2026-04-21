/**
 * Run async tasks with a fixed concurrency limit while preserving submission order for scheduling.
 */
export async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length }, () => undefined as R);
  let idx = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      const item = items[current];
      if (item === undefined) throw new Error("runPool: index out of range");
      results[current] = await worker(item);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(runners);
  return results;
}
