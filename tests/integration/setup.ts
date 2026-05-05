/**
 * Integration test setup file — runs once before ALL integration test files.
 *
 * Listed in `vitest.config.ts` under `setupFiles` for the "integration" project.
 * Vitest treats an unhandled throw here as a hard stop — no integration tests
 * will run if this file throws.
 *
 * Safety contract (NFR-CI gating, S10):
 *   1. Require RUN_INTEGRATION=1 — prevents accidental runs in CI/CD.
 *   2. Require KANBOARD_URL, KANBOARD_API_TOKEN, KANBOARD_TEST_PROJECT_ID.
 *   3. Bootstrap a real handler bundle via bootstrap() to confirm env is wired.
 *   4. Fetch the test project by ID and assert its name contains "sandbox" or
 *      "test" (case-insensitive). This prevents running integration tests against
 *      a production project.
 *
 * Exported surface — import from "./setup.js" in test files:
 *   handler       — KanboardHandler instance (wired, live)
 *   bundle        — full HandlerBundle (handler + resolvers + apiClient)
 *   projectId     — numeric KANBOARD_TEST_PROJECT_ID
 *   testProjectName — name of the test project (for assertions)
 */

import { bootstrap } from "../../src/transports/bootstrap.js";
import type { KanboardHandler } from "../../src/handler/kanboard.js";
import type { HandlerBundle } from "../../src/handler/index.js";
import { ConfigError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Gate 1 — RUN_INTEGRATION=1
// ---------------------------------------------------------------------------

const runIntegration = process.env["RUN_INTEGRATION"];

if (runIntegration !== "1") {
  throw new Error(
    "[kanboard-mcp integration] Skipped: RUN_INTEGRATION !== '1'. " +
      "Set RUN_INTEGRATION=1 to activate integration tests.",
  );
}

// ---------------------------------------------------------------------------
// Gate 2 — Required env vars
// ---------------------------------------------------------------------------

const REQUIRED_VARS = ["KANBOARD_URL", "KANBOARD_API_TOKEN", "KANBOARD_TEST_PROJECT_ID"] as const;

for (const varName of REQUIRED_VARS) {
  const val = process.env[varName];
  if (val === undefined || val.trim() === "") {
    throw new Error(
      `[kanboard-mcp integration] Missing required env var: ${varName}. ` +
        `Set ${varName} before running integration tests.`,
    );
  }
}

// Recommended but optional — warn if missing
const recommendedVars = ["KANBOARD_USERNAME", "KANBOARD_AUTH_MODE"] as const;
for (const varName of recommendedVars) {
  if (process.env[varName] === undefined) {
    process.stderr.write(
      `[kanboard-mcp integration] WARN: ${varName} is not set (recommended). ` +
        `Defaulting will be used.\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Parse project ID
// ---------------------------------------------------------------------------

const rawProjectId = process.env["KANBOARD_TEST_PROJECT_ID"] ?? "";
const projectId = Number(rawProjectId);

if (!Number.isInteger(projectId) || projectId <= 0) {
  throw new Error(
    `[kanboard-mcp integration] KANBOARD_TEST_PROJECT_ID must be a positive integer. ` +
      `Received: "${rawProjectId}"`,
  );
}

// ---------------------------------------------------------------------------
// Gate 3 — Bootstrap the handler bundle
// ---------------------------------------------------------------------------

let bundle: HandlerBundle;
let handler: KanboardHandler;

try {
  const result = bootstrap(process.env);
  bundle = result.bundle;
  handler = bundle.handler;
} catch (err) {
  if (err instanceof ConfigError) {
    throw new Error(
      `[kanboard-mcp integration] Bootstrap failed with ConfigError: ${err.message}. ` +
        `Check KANBOARD_URL, KANBOARD_API_TOKEN, and KANBOARD_AUTH_MODE env vars.`,
    );
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Gate 4 — Safety check: test project name must contain "sandbox" or "test"
// ---------------------------------------------------------------------------

let testProjectName: string;

try {
  const project = await handler.getProjectById(projectId);
  testProjectName = project.name;

  const nameLower = project.name.toLowerCase();
  const identifierLower = project.identifier.toLowerCase();

  const isSafe =
    nameLower.includes("sandbox") ||
    nameLower.includes("test") ||
    identifierLower.includes("sandbox") ||
    identifierLower.includes("test");

  if (!isSafe) {
    throw new Error(
      `[kanboard-mcp integration] REFUSING to run integration tests against ` +
        `project "${project.name}" (id=${String(projectId)}). ` +
        `The project name or identifier MUST contain "sandbox" or "test" (case-insensitive) ` +
        `to prevent production data pollution. ` +
        `Set KANBOARD_TEST_PROJECT_ID to a dedicated test/sandbox project.`,
    );
  }

  process.stderr.write(
    `[kanboard-mcp integration] Safety check PASSED: ` +
      `project "${project.name}" (id=${String(projectId)}) — safe to use.\n`,
  );
} catch (err) {
  // Re-throw safety errors as-is; wrap other errors (network, not-found).
  if (err instanceof Error && err.message.startsWith("[kanboard-mcp integration]")) {
    throw err;
  }
  throw new Error(
    `[kanboard-mcp integration] Failed to fetch test project (id=${String(projectId)}): ` +
      `${err instanceof Error ? err.message : String(err)}. ` +
      `Check KANBOARD_URL, KANBOARD_API_TOKEN, and KANBOARD_TEST_PROJECT_ID.`,
  );
}

// ---------------------------------------------------------------------------
// Export wired context for test files
// ---------------------------------------------------------------------------

export { handler, bundle, projectId, testProjectName };
