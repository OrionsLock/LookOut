/**
 * Simple per-minute request gate used to avoid hammering provider APIs.
 */
export class PerMinuteLimiter {
  private readonly times: number[] = [];

  constructor(private readonly maxPerMinute: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    while (this.times.length > 0 && now - (this.times[0] ?? 0) >= 60_000) {
      this.times.shift();
    }
    if (this.times.length < this.maxPerMinute) {
      this.times.push(Date.now());
      return;
    }
    const oldest = this.times[0] ?? now;
    const wait = Math.max(0, 60_000 - (Date.now() - oldest));
    await new Promise<void>((resolve) => setTimeout(resolve, wait));
    return this.acquire();
  }
}
