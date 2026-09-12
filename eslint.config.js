// @ts-check
import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  // `*.dev.mjs` is a throwaway script for driving the real MCP server by hand — a real mission on a real
  // repository, which is how several of this project's bugs were found. They are never committed (see
  // .gitignore) and belong to no tsconfig, so linting them only ever produces a parse error.
  globalIgnores(["**/dist/", "**/coverage/", "**/node_modules/", "**/*.dev.mjs"]),
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-console": "error",
    },
  },
  {
    files: ["*.config.js", "*.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
