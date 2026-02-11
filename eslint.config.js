import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import noOnlyTests from "eslint-plugin-no-only-tests";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strict,
  {
    ignores: ["**/node_modules/", "**/build/", "**/dist/"],
  },
  {
    plugins: {
      "no-only-tests": noOnlyTests,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "no-only-tests/no-only-tests": "error",
    },
  },
);
