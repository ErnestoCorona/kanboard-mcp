// @ts-check
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Use defineConfig (ESLint 9 core, replaces the deprecated tseslint.config helper).
// tsconfig.eslint.json (Option A) widens the TypeScript project to include
// tests/ and root *.config.ts files so the type-aware parser can resolve them
// without weakening the src-only strictness of the main tsconfig.json.
export default defineConfig(
  // Base TypeScript-ESLint strict config
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Project-level settings.
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Global rule overrides applied to all matched files
  {
    rules: {
      // Allow intentionally unused variables/parameters prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "all",
          argsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // Rules applied to all TypeScript source files
  {
    files: ["src/**/*.ts"],
    rules: {
      // Pino is the canonical logger — console.log pollutes the MCP stdout channel
      "no-console": ["error", { allow: ["error"] }],

      // Enforce no implicit any
      "@typescript-eslint/no-explicit-any": "error",

      // Require exhaustive type handling
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Avoid floating promises
      "@typescript-eslint/no-floating-promises": "error",

      // Require explicit return types on exported functions
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },

  // Relax some rules for config files at root
  {
    files: ["*.config.ts", "*.config.js", "eslint.config.js"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },

  // Ignore built output, dependencies, and standalone scripts (not in tsconfig)
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "scripts/**", "skills/**"],
  },
);
