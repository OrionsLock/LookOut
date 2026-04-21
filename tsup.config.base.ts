import { defineConfig, type Options } from "tsup";

export function createTsupConfig(overrides: Options): Options {
  return defineConfig({
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    ...overrides,
  });
}
