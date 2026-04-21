import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunExportBundle, createStore } from "./index.js";

describe("buildRunExportBundle", () => {
  it("returns null for missing run", async () => {
    const root = path.join(process.cwd(), `export-missing-${Date.now()}`);
    await mkdir(path.join(root, ".lookout"), { recursive: true });
    const store = createStore(path.join(root, ".lookout"));
    try {
      const init = await store.init();
      expect(init.ok).toBe(true);
      const b = await buildRunExportBundle(store, store.rootDir, root, "nope");
      expect(b).toBeNull();
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
