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
    // The build scripts are plain Node ESM: real globals, and JSON that arrives as `any` however it is read.
    files: ["scripts/*.mjs"],
    rules: {
      // TypeScript checks these files (`scripts/tsconfig.json`, `checkJs`), and it knows Node's globals; `no-undef`
      // does not, and adding a dependency to teach it would be a dependency for nothing.
      "no-undef": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    languageOptions: {
      /*
       * `scripts/tsconfig.json` exists so the build scripts are linted like everything else. A script that packs
       * and publishes the product is the wrong place to stop checking, and without a project of their own the
       * type-aware rules see every Node global as an error.
       */
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
