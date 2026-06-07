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
 * (e.g. `create_comment`). This avoids startup brittleness in app mode while
 * keeping the typical case latency-free.
 *
 * ### Barrel re-exports
 * Downstream layers (tools, transports) import everything from
 * `src/handler/index.ts` — no need to reference the individual files.
 */

import type { Logger } from "pino";
import { createLogger } from "../shared/logger.js";
import type { ConfigError } from "../shared/errors.js";
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

// ---------------------------------------------------------------------------
// Degraded factory — lazy credential validation
// ---------------------------------------------------------------------------

/**
 * Build a `Proxy` that pretends to satisfy the shape of `T` but throws the
 * supplied {@link ConfigError} the moment ANY of its methods is invoked.
 *
 * Why: MCP registries / inspectors (e.g. Glama) enumerate a server's tools by
 * RUNNING it WITHOUT the operator's secret credentials. The `tools/list`
 * response is static — tool name / description / inputSchema need no creds — so
 * the server MUST stay listable even when `loadEnv()` failed. Tool EXECUTION,
 * however, genuinely needs working credentials, so each handler / resolver /
 * apiClient method must fail loudly with the original `ConfigError`.
 *
 * Implementation notes:
 * - The throw is SYNCHRONOUS. Every tool handler reaches these collaborators
 *   via `await handler.foo(...)` / `await resolvers.bar(...)`, so a synchronous
 *   throw inside the awaited call surfaces as a rejected promise — i.e. the
 *   tool's normal error path — and is rendered as a `CONFIG_ERROR` tool result.
 * - `then` and any symbol key return `undefined` so the proxy is NOT mistaken
 *   for a thenable (which would corrupt `await`/Promise interop) and so engine
 *   internals probing well-known symbols don't blow up.
 *
 * @typeParam T - The interface the proxy must masquerade as (cast at call site).
 * @param error - The `ConfigError` to throw on every method access.
 * @returns A proxy object structurally usable as a `T`.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function throwingProxy<T extends object>(error: ConfigError): T {
  return new Proxy({} as T, {
    get(_target, prop): unknown {
      // Avoid being mistaken for a thenable / breaking interop with engine
      // internals that probe well-known symbols.
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return (): never => {
        throw error;
      };
    },
  });
}

/**
 * Build a {@link HandlerBundle} for DEGRADED mode — used when `loadEnv()` threw
 * a {@link ConfigError} (missing / invalid credentials) but the server must
 * still start so that `initialize` and `tools/list` work.
 *
 * Every component (`apiClient`, `handler`, `resolvers`) is a {@link throwingProxy}
 * that throws the given `error` on the first method call. No network client is
 * constructed, no `getMe()` fires — there are no credentials to use. The tool
 * layer continues to register all tools normally; only EXECUTION fails, with a
 * clear `ConfigError` telling the operator to fix the environment.
 *
 * @param error - The `ConfigError` produced by `loadEnv()`.
 * @returns A bundle whose every method throws `error` when invoked.
 *
 * @example
 * ```ts
 * // Inside bootstrap(), on the ConfigError path:
 * const bundle = createDegradedBundle(configError);
 * registerTools(server, { handler: bundle.handler, resolvers: bundle.resolvers, logger });
 * ```
 */
export function createDegradedBundle(error: ConfigError): HandlerBundle {
  return {
    apiClient: throwingProxy<ApiClient>(error),
    handler: throwingProxy<KanboardHandler>(error),
    resolvers: throwingProxy<Resolvers>(error),
  };
}
