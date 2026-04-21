import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LookoutConfigSchema } from "@lookout/config";
import { createMockLlm } from "@lookout/llm";
import { createStore } from "@lookout/store";
import { createOrchestrator } from "./orchestrator.js";

const chromiumReady = existsSync(chromium.executablePath());
const describeIntegration = chromiumReady ? describe : describe.skip;

describeIntegration("createOrchestrator (integration)", () => {
  const tmp = path.join(os.tmpdir(), `orch-int-${Date.now()}`);
  let baseUrl = "";
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><head><title>Ok</title></head><body><h1>Smoke</h1></body></html>");
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(tmp, { recursive: true, force: true });
  });

  it("completes a mock goal against a live HTTP page", async () => {
    const config = LookoutConfigSchema.parse({
      baseUrl,
      auth: { type: "none" },
      llm: { provider: "mock", model: "mock", vision: false, maxTokens: 256 },
      crawl: { goals: [{ id: "smoke", prompt: "123456789012 integration smoke" }] },
    });
    const store = createStore(path.join(tmp, ".lookout"));
    try {
      const llm = createMockLlm([{ kind: "complete", reason: "integration" }]);
      const telemetry = { inputTokens: 0, outputTokens: 0, planCalls: 0, scoreCalls: 0 };
      const orch = createOrchestrator({ config, store, llm, headed: false, telemetry });
      const r = await orch.run();
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.verdict).toBe("clean");
        expect(r.value.summary.goalsComplete).toBe(1);
      }
    } finally {
      store.close();
    }
  });
});
