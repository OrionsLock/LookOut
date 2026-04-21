import eslint from "@eslint/js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const typedTsFiles = ["packages/*/src/**/*.ts", "packages/*/**/*.test.ts"];

export default tseslint.config(
  eslint.configs.recommended,
  prettier,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "examples/**",
      "prettier.config.cjs",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: typedTsFiles,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    files: typedTsFiles,
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/require-await": "off",
    },
  },
);
