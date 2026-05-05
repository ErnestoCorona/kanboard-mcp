/**
 * Self-test command — validates Kanboard credentials and connectivity without
 * starting the MCP server. Designed for CI smoke checks and onboarding.
 *
 * Runs three read-only checks in order:
 *   1. getVersion()     — Kanboard server reachable and responds.
 *   2. getMe()          — personal mode only; skipped in app mode.
 *   3. getMyProjects()  — at least one visible project.
 *
 * Exit code 0: all required checks pass.
 * Exit code 1: one or more required checks fail, or env is misconfigured.
 *
 * All output goes to **stderr** — stdout is the MCP JSON-RPC lane and must
 * stay silent even though selftest never speaks MCP.
 */

import { loadEnv } from "../config/env.js";
import { bootstrap } from "../transports/bootstrap.js";
import { ConfigError, KanboardApiError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// runSelftest
// ---------------------------------------------------------------------------

/**
 * Run the kanboard-mcp self-test.
 *
 * All checks print to **stderr** so this function is safe to use alongside
 * stdio transports (stdout is the MCP JSON-RPC channel).
 *
 * @param env - Process environment (defaults to `process.env`).
 * @returns Exit code: `0` when all required checks pass, `1` on any failure.
 */
export async function runSelftest(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  // ─── 1. Load and validate env ──────────────────────────────────────────────
  let parsedEnv: ReturnType<typeof loadEnv>;

  try {
    parsedEnv = loadEnv(env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fail] env: ${msg}`);
    return 1;
  }

  // ─── 2. Bootstrap (create handler bundle via the same wiring as the server) ─
  let handler: Awaited<ReturnType<typeof bootstrap>>["bundle"]["handler"];

  try {
    const result = bootstrap(env);
    handler = result.bundle.handler;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fail] bootstrap: ${msg}`);
    return 1;
  }

  let passed = 0;
  let failed = 0;

  // ─── 3a. getVersion ───────────────────────────────────────────────────────
  try {
    const version = await handler.getVersion();
    console.error(`[ok] kanboard server version: ${version}`);
    passed++;
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : "Error";
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fail] getVersion: ${name} — ${msg}`);
    failed++;
    // getVersion is required — no point continuing if the server is unreachable
    return 1;
  }

  // ─── 3b. getMe (personal mode only) ───────────────────────────────────────
  if (parsedEnv.mode === "personal") {
    try {
      const me = await handler.getMe();
      console.error(`[ok] authenticated as: ${me.username} (id=${String(me.id)})`);
      passed++;
    } catch (err) {
      const name = err instanceof Error ? err.constructor.name : "Error";
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[fail] getMe: ${name} — ${msg}`);
      failed++;
    }
  } else {
    console.error(`[skip] getMe — not applicable in app mode`);
  }

  // ─── 3c. getMyProjects ───────────────────────────────────────────────────
  try {
    const projects = await handler.getMyProjects();
    console.error(`[ok] visible projects: ${String(projects.length)}`);
    passed++;
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : "Error";
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fail] getMyProjects: ${name} — ${msg}`);
    failed++;
  }

  // ─── 4. Summary ───────────────────────────────────────────────────────────
  if (failed === 0) {
    console.error(`[ok] selftest passed (${String(passed)} checks)`);
    return 0;
  }

  console.error(`[fail] selftest failed (${String(failed)} check(s) failed)`);
  return 1;
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked as a script, not when imported by tests
// ---------------------------------------------------------------------------

// Re-export errors so test files can import from here without reaching into src
export { ConfigError, KanboardApiError };

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  void runSelftest().then((code) => process.exit(code));
}
