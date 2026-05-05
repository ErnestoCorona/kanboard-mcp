/**
 * HTTP / SSE transport — Phase 3 placeholder (post-v1).
 *
 * This module is intentionally minimal. It reserves the module path and
 * documents the phase-3 design intent. No implementation in v1.
 *
 * PHASE 3 DESIGN INTENT (see design §9 "Phase 3 Readiness"):
 * - Per-request handler instantiation from Authorization headers
 *   (X-Kanboard-Url, X-Kanboard-Username, X-Kanboard-Token, X-Kanboard-Auth-Mode).
 * - Recommended framework: Hono (runtime-agnostic). Fallback: Fastify.
 * - bootstrap.ts is the seam — both stdio and http will call it identically;
 *   only the transport bind differs.
 */

/**
 * HTTP transport entry point — Phase 3 placeholder.
 *
 * This function always throws. Use stdio transport (`runStdio`) in v1.
 *
 * @throws {Error} Always — HTTP transport is not implemented in v1.
 */
export function runHttp(): never {
  throw new Error("HTTP transport is a placeholder for v2; use stdio in v1.");
}
