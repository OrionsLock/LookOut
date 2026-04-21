import { defineProject } from "vitest/config";

export default defineProject({
  test: { pool: "forks", testTimeout: 60_000 },
});
