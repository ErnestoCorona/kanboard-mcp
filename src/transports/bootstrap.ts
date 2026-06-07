/**
 * Shared bootstrap factory for all transport layers.
 *
 * `bootstrap()` loads all configuration, constructs the KanboardHandler bundle,
 * builds an MCP `McpServer`, and registers all 37 tools. Each transport (stdio,
 * and the future HTTP transport) calls this once at startup.
 *
 * Transport-agnostic: does NOT bind any transport. Only constructs and wires
 * objects — callers decide which transport to connect.
 *
 * ### Lazy credential validation (degraded mode)
 * `bootstrap()` NO LONGER refuses to start when credentials are missing. The
 * MCP `tools/list` response is STATIC (tool name / description / inputSchema
 * need no credentials), so registries / inspectors that enumerate a server by
 * RUNNING it WITHOUT the operator's secrets must still see every tool. When
 * `loadEnv()` throws a `ConfigError`, `bootstrap()` enters DEGRADED mode: it
 * builds a {@link createDegradedBundle | degraded bundle} (every method throws
 * the original `ConfigError`), registers all tools as normal, and returns with
 * `parsedEnv: null` and `configError` set. Tool LISTING works; tool EXECUTION
 * fails loudly with a clear `CONFIG_ERROR` until the environment is fixed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { loadEnv, type ParsedEnv } from "../config/env.js";
import { createHandler, createDegradedBundle, type HandlerBundle } from "../handler/index.js";
import { createLogger } from "../shared/logger.js";
import { ConfigError } from "../shared/errors.js";
import { KANBOARD_MCP_VERSION } from "../shared/constants.js";
import { registerTools } from "../tools/index.js";

// ---------------------------------------------------------------------------
// BootstrapResult
// ---------------------------------------------------------------------------

/**
 * All wired objects returned by `bootstrap()`.
 *
 * Transports destructure this to get the server (for `connect()`) and the
 * logger/parsedEnv (for the startup banner and process lifecycle).
 */
export interface BootstrapResult {
  /** Configured MCP server with all 37 tools registered. Ready to connect. */
  server: McpServer;
  /**
   * Handler layer bundle: apiClient + handler + resolvers.
   *
   * In DEGRADED mode (see {@link configError}) this is a degraded bundle whose
   * every method throws the original `ConfigError` when invoked.
   */
  bundle: HandlerBundle;
  /** Pino logger instance writing JSON to stderr. */
  logger: Logger;
  /**
   * Fully validated env including KanboardConfig fields + logLevel — or `null`
   * when the server started in DEGRADED mode (credentials missing / invalid).
   * Callers MUST guard for `null` before reading fields like `url` / `mode`.
   */
  parsedEnv: ParsedEnv | null;
  /**
   * The `ConfigError` raised by `loadEnv()` when the server started in DEGRADED
   * mode, or `null` on the normal (fully credentialed) path. When non-null,
   * {@link parsedEnv} is `null` and every {@link bundle} method throws this error.
   */
  configError: ConfigError | null;
}

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

/**
 * Load configuration, build the handler bundle, create an `McpServer`, and
 * register all 37 Kanboard tools.
 *
 * Order of operations (normal path):
 * 1. `loadEnv(env)` — validates env vars, throws `ConfigError` on failure.
 * 2. `createLogger(...)` — creates pino logger writing to stderr.
 * 3. `createHandler(parsedEnv, { logger })` — wires ApiClient + KanboardHandler
 *    + Resolvers. The KanboardConfig portion is projected from ParsedEnv.
 * 4. `new McpServer(...)` — creates a bare MCP server.
 * 5. `registerTools(server, deps)` — mounts all 37 tools on the server.
 * 6. Returns `{ server, bundle, logger, parsedEnv, configError: null }`.
 *
 * Degraded path: when step 1 throws a `ConfigError` (missing / invalid creds),
 * `bootstrap()` does NOT propagate it. Instead it emits a prominent stderr
 * WARNING, builds a degraded bundle (every method throws the `ConfigError`),
 * registers all tools so `tools/list` still works, and returns with
 * `parsedEnv: null` and `configError` set. This keeps the server LISTABLE for
 * registries / inspectors that run it without the operator's secrets while
 * still failing every tool CALL with a clear, actionable error.
 *
 * Any error from `loadEnv()` that is NOT a `ConfigError` is genuinely
 * unexpected and is re-thrown so the process still fails loudly.
 *
 * This function is synchronous. getMe() runs eagerly in the background inside
 * `createHandler` but is NOT awaited here (eager-but-non-fatal contract from
 * design §1a). In degraded mode no `getMe()` fires at all.
 *
 * @param env - Process environment object (defaults to `process.env`).
 * @returns Fully wired {@link BootstrapResult}. Never throws `ConfigError` for
 *   missing / invalid credentials — that is deferred to tool-call time.
 * @throws Any non-`ConfigError` thrown by `loadEnv()` (genuinely unexpected).
 *
 * @example
 * ```ts
 * // In a custom transport — call once at startup.
 * const { server, parsedEnv, logger } = bootstrap();
 * const transport = new StdioServerTransport();
 * await server.connect(transport);
 * ```
 */
export function bootstrap(env: NodeJS.ProcessEnv = process.env): BootstrapResult {
  // 1. Load and validate env vars. On a ConfigError (missing / invalid creds)
  //    we fall through to DEGRADED mode instead of refusing to start, so that
  //    `initialize` and `tools/list` keep working for credential-less callers.
  let parsedEnv: ParsedEnv;
  try {
    parsedEnv = loadEnv(env);
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      return bootstrapDegraded(err);
    }
    // Genuinely unexpected — must still fail loudly.
    throw err;
  }

  // 2. Create Pino logger (JSON to stderr, level from env).
  const logger = createLogger({ level: parsedEnv.logLevel, mode: parsedEnv.mode });

  // 3. Project ParsedEnv → KanboardConfig and create the handler bundle.
  //    logLevel is NOT passed to createHandler — it belongs to the transport layer.
  const bundle = createHandler(
    {
      url: parsedEnv.url,
      apiToken: parsedEnv.apiToken,
      mode: parsedEnv.mode,
      username: parsedEnv.username,
      timeoutMs: parsedEnv.timeoutMs,
    },
    { logger },
  );

  // 4. Build a bare McpServer with server identity.
  const server = new McpServer({
    name: "kanboard-mcp",
    version: KANBOARD_MCP_VERSION,
  });

  // 5. Register all 37 tools on the server.
  registerTools(server, {
    handler: bundle.handler,
    resolvers: bundle.resolvers,
    logger,
  });

  // 6. Return the fully wired bundle.
  return { server, bundle, logger, parsedEnv, configError: null };
}

// ---------------------------------------------------------------------------
// bootstrapDegraded — credentials missing / invalid
// ---------------------------------------------------------------------------

/**
 * Build a fully tool-registered `McpServer` in DEGRADED mode after `loadEnv()`
 * raised the given `ConfigError`.
 *
 * Same wiring as the normal path EXCEPT the handler bundle is a degraded bundle
 * (every method throws `configError`) and no real network client is built. A
 * single prominent stderr WARNING tells human operators the server is running
 * WITHOUT valid credentials: `tools/list` works, but every tool CALL will fail
 * until the environment is fixed.
 *
 * @param configError - The `ConfigError` produced by `loadEnv()`.
 * @returns A {@link BootstrapResult} with `parsedEnv: null` and `configError` set.
 */
function bootstrapDegraded(configError: ConfigError): BootstrapResult {
  // No parsedEnv → fall back to a default-level logger (info). `mode` is unknown.
  const logger = createLogger({ level: "info" });

  // ONE prominent operator-facing warning. The error NAME/MESSAGE are safe to
  // log — env.ts guarantees the token VALUE is never present in the message.
  logger.warn(
    { err: { name: configError.name } },
    `kanboard-mcp started WITHOUT valid credentials — running in DEGRADED mode. ` +
      `Tools are LISTABLE (tools/list works) but every tool CALL will fail until ` +
      `the environment is fixed. Cause: ${configError.message}`,
  );

  // Degraded bundle: every method throws the ConfigError on invocation.
  const bundle = createDegradedBundle(configError);

  // Build the server and register all tools — IDENTICAL to the normal path so
  // tools/list returns the full, static tool surface.
  const server = new McpServer({
    name: "kanboard-mcp",
    version: KANBOARD_MCP_VERSION,
  });

  registerTools(server, {
    handler: bundle.handler,
    resolvers: bundle.resolvers,
    logger,
  });

  return { server, bundle, logger, parsedEnv: null, configError };
}
