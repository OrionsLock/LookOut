import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

const tmpBase = path.join(process.cwd(), "tmp-config-test");

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns not_found when missing", async () => {
    const dir = path.join(tmpBase, "empty");
    await mkdir(dir, { recursive: true });
    const r = await loadConfig(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("parses minimal valid json with defaults", async () => {
    const dir = path.join(tmpBase, "a");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "lookout.config.json"),
      JSON.stringify({
        baseUrl: "http://localhost:3000",
        crawl: {
          goals: [{ id: "sign-in", prompt: "aaaaaaaaaa" }],
        },
      }),
    );
    const r = await loadConfig(dir);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.crawl.maxStepsPerGoal).toBe(30);
      expect(r.value.llm.provider).toBe("anthropic");
    }
  });

  it("validates missing baseUrl", async () => {
    const dir = path.join(tmpBase, "b");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "lookout.config.json"),
      JSON.stringify({
        crawl: { goals: [{ id: "x", prompt: "12345678901" }] },
      }),
    );
    const r = await loadConfig(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation_error");
  });

  it("credentials without username fails", async () => {
    const dir = path.join(tmpBase, "c");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "lookout.config.json"),
      JSON.stringify({
        baseUrl: "http://localhost:3000",
        auth: {
          type: "credentials",
          loginUrl: "/login",
          usernameSelector: "#u",
          passwordSelector: "#p",
          submitSelector: "#s",
          username: "",
          password: "x",
        },
        crawl: { goals: [{ id: "g", prompt: "12345678901" }] },
      }),
    );
    const r = await loadConfig(dir);
    expect(r.ok).toBe(false);
  });

  it("loads explicit configFile when provided", async () => {
    const dir = path.join(tmpBase, "cfgfile");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "custom.json"),
      JSON.stringify({
        baseUrl: "http://localhost:3000",
        crawl: { goals: [{ id: "x", prompt: "12345678901" }] },
      }),
    );
    const r = await loadConfig(dir, { configFile: "custom.json" });
    expect(r.ok).toBe(true);
  });

  it("dereferences process.env in evaluated config", async () => {
    const dir = path.join(tmpBase, "d");
    await mkdir(dir, { recursive: true });
    process.env.FOO_BAR_LOOKOUT = "http://localhost:9999";
    await writeFile(
      path.join(dir, "lookout.config.mjs"),
      `export default {
        baseUrl: process.env.FOO_BAR_LOOKOUT,
        crawl: { goals: [{ id: "g", prompt: "12345678901" }] },
      };`,
    );
    const r = await loadConfig(dir);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.baseUrl).toBe("http://localhost:9999");
    delete process.env.FOO_BAR_LOOKOUT;
  });
});
