import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Two separate projects: unit (always runs) and integration (gated by RUN_INTEGRATION=1).
    // Vitest v4 replaces the `workspace` array with `projects` inside defineConfig.
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          globals: false,
          // Default timeout per test. The stdio protocol smoke test spawns a child
          // process which can take a few seconds — 30s covers CI cold starts.
          testTimeout: 30_000,
          coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/index.ts"],
            // Thresholds per design (applied at CI stage, not enforced in local runs)
            thresholds: {
              lines: 80,
              functions: 80,
              branches: 75,
              statements: 80,
            },
          },
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.int.test.ts"],
          environment: "node",
          globals: false,
          // Integration tests only run when RUN_INTEGRATION=1 is set.
          // The setup file enforces the KANBOARD_TEST_PROJECT_ID gate.
          setupFiles: ["tests/integration/setup.ts"],
        },
      },
    ],
  },
});
