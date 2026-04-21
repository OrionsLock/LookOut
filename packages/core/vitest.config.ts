import { defineProject } from "vitest/config";

export default defineProject({
  test: { pool: "forks", testTimeout: 120_000 },
});
