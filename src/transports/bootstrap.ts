/**
 * Shared bootstrap factory for all transport layers.
 *
 * `bootstrap()` loads all configuration, constructs the KanboardHandler bundle,
 * builds an MCP `McpServer`, and registers all 25 tools. Each transport (stdio,
 * and the future HTTP transport) calls this once at startup.
 *
 * Transport-agnostic: does NOT bind any transport. Only constructs and wires
 * objects — callers decide which transport to connect.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { loadEnv, type ParsedEnv } from "../config/env.js";
import { createHandler, type HandlerBundle } from "../handler/index.js";
import { createLogger } from "../shared/logger.js";
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
  /** Configured MCP server with all 25 tools registered. Ready to connect. */
  server: McpServer;
  /** Handler layer bundle: apiClient + handler + resolvers. */
  bundle: HandlerBundle;
  /** Pino logger instance writing JSON to stderr. */
  logger: Logger;
  /** Fully validated env including KanboardConfig fields + logLevel. */
  parsedEnv: ParsedEnv;
}

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

/**
 * Load configuration, build the handler bundle, create an `McpServer`, and
 * register all 25 Kanboard tools.
 *
 * Order of operations:
 * 1. `loadEnv(env)` — validates env vars, throws `ConfigError` on failure.
 * 2. `createLogger(...)` — creates pino logger writing to stderr.
 * 3. `createHandler(parsedEnv, { logger })` — wires ApiClient + KanboardHandler
 *    + Resolvers. The KanboardConfig portion is projected from ParsedEnv.
 * 4. `new McpServer(...)` — creates a bare MCP server.
 * 5. `registerTools(server, deps)` — mounts all 25 tools on the server.
 * 6. Returns `{ server, bundle, logger, parsedEnv }`.
 *
 * This function is synchronous. getMe() runs eagerly in the background inside
 * `createHandler` but is NOT awaited here (eager-but-non-fatal contract from
 * design §1a).
 *
 * @param env - Process environment object (defaults to `process.env`).
 * @returns Fully wired {@link BootstrapResult}.
 * @throws {ConfigError} when required env vars are missing or invalid.
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
  // 1. Load and validate env vars — throws ConfigError on bad env.
  const parsedEnv = loadEnv(env);

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

  // 5. Register all 25 tools on the server.
  registerTools(server, {
    handler: bundle.handler,
    resolvers: bundle.resolvers,
    logger,
  });

  // 6. Return the fully wired bundle.
  return { server, bundle, logger, parsedEnv };
}
