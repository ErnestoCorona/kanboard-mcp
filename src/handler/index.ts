/**
 * Handler factory — `src/handler/index.ts`
 *
 * `createHandler(config, opts?)` wires the three components of the handler
 * layer together and returns them as a `HandlerBundle`:
 *   1. `ApiClient`       — low-level JSON-RPC 2.0 transport
 *   2. `KanboardHandler` — 31 typed methods + getMe() cache (eager-but-non-fatal)
 *   3. `Resolvers`       — column-name and swimlane caches (tool-layer collaborator)
 *
 * ### getMe() eager-but-non-fatal contract
 * `KanboardHandler`'s ctor fires getMe() in the background — the factory does
 * NOT await it. Failure surfaces only when a tool awaits `handler.getMe()`
 * (e.g. `add_comment`). This avoids startup brittleness in app mode while
 * keeping the typical case latency-free.
 *
 * ### Barrel re-exports
 * Downstream layers (tools, transports) import everything from
 * `src/handler/index.ts` — no need to reference the individual files.
 */

import type { Logger } from "pino";
import { createLogger } from "../shared/logger.js";
import type { KanboardConfig } from "../shared/types.js";
import { ApiClient } from "./api-client.js";
import { KanboardHandler } from "./kanboard.js";
import { Resolvers } from "./resolvers.js";

// ---------------------------------------------------------------------------
// Re-exports (barrel) — downstream imports one path for the entire layer
// ---------------------------------------------------------------------------

export { ApiClient } from "./api-client.js";
export { KanboardHandler } from "./kanboard.js";
export { Resolvers } from "./resolvers.js";

// ---------------------------------------------------------------------------
// HandlerBundle
// ---------------------------------------------------------------------------

/**
 * All three components of the handler layer, wired together by `createHandler`.
 *
 * The tool layer (Batch C) destructures this bundle; transports call
 * `createHandler` once per process (stdio) or once per session (http/phase-3).
 */
export interface HandlerBundle {
  /** Low-level JSON-RPC transport. */
  apiClient: ApiClient;
  /** 31 typed Kanboard methods + getMe() cache. */
  handler: KanboardHandler;
  /** Column-name and swimlane resolver with per-project caches. */
  resolvers: Resolvers;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Wire ApiClient → KanboardHandler → Resolvers and return the bundle.
 *
 * @param config - Validated Kanboard connection config (from `loadEnv()`).
 * @param opts   - Optional overrides: currently only `logger` injection.
 * @returns      - {@link HandlerBundle} — all three components, ready for use.
 *
 * @throws {ConfigError} when config is invalid (delegated to `ApiClient` ctor).
 *
 * @example
 * ```ts
 * const config = loadEnv();
 * const { handler, resolvers } = createHandler(config);
 * const projects = await handler.getMyProjects();
 * ```
 */
export function createHandler(
  config: KanboardConfig,
  opts?: { logger?: Logger },
): HandlerBundle {
  // 1. Build shared logger (injected or default).
  //    Passing `mode` lets the logger tag its output with the auth mode.
  const logger = opts?.logger ?? createLogger({ mode: config.mode });

  // 2. Construct ApiClient.
  //    Throws ConfigError immediately if personal mode is missing username.
  const apiClient = new ApiClient({ config, logger });

  // 3. Construct KanboardHandler.
  //    Kicks off getMe() eagerly in the background — does NOT block here.
  const handler = new KanboardHandler({ apiClient, logger });

  // 4. Construct Resolvers (depends on handler for getColumns / getActiveSwimlanes).
  const resolvers = new Resolvers({ handler, logger });

  return { apiClient, handler, resolvers };
}
