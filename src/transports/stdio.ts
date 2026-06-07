/**
 * stdio transport entry point.
 *
 * Wires the MCP server to the stdio transport (stdin/stdout JSON-RPC channel).
 * All logs go to stderr via Pino — stdout is exclusively the MCP protocol channel.
 *
 * CRITICAL: Never write to stdout inside this module. MCP frames are the only
 * valid stdout content in stdio mode. All logging (including the startup banner)
 * goes through the pino logger which is configured to write to stderr (fd 2).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bootstrap } from "./bootstrap.js";
import { KANBOARD_MCP_VERSION } from "../shared/constants.js";

// ---------------------------------------------------------------------------
// runStdio
// ---------------------------------------------------------------------------

/**
 * Bootstrap all dependencies, register tools, connect to the stdio transport,
 * and block until the transport closes (stdin EOF, SIGINT, or SIGTERM).
 *
 * - Emits a startup banner to stderr (via pino) with version, node, target, mode.
 *   In DEGRADED mode (missing / invalid credentials) it emits a degraded-mode
 *   warning banner instead — never crashes, never writes to stdout.
 * - Handles SIGINT / SIGTERM gracefully by closing the transport before exiting.
 * - All logs go to **stderr** via pino — **stdout** is exclusively the MCP JSON-RPC channel.
 * - Does NOT reject for missing credentials: `bootstrap()` now defers that
 *   `ConfigError` to tool-call time (lazy credential validation). Only genuinely
 *   unexpected boot errors are propagated to the caller.
 *
 * Transport selection in v1 is HARDCODED to stdio. http.ts is a phase-3 placeholder.
 *
 * @param env - Process environment object (defaults to `process.env`).
 * @returns A promise that resolves when the transport closes.
 * @throws Any genuinely unexpected error thrown by `bootstrap()` (NOT the
 *   `ConfigError` for missing / invalid credentials — that is now deferred).
 *
 * @example
 * ```ts
 * // Typical usage from the CLI entry point:
 * await runStdio();
 * ```
 */
export async function runStdio(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  // 1. Bootstrap — loads env, wires handler, builds server, registers tools.
  //    parsedEnv is null when running in DEGRADED mode (credentials missing).
  const { server, parsedEnv, logger } = bootstrap(env);

  // 2. Startup banner — all fields go to stderr via pino; no credential material.
  //    Format: kanboard-mcp v<x.y.z> | node v22 | target=<host> | mode=<personal|app>
  if (parsedEnv !== null) {
    logger.info(
      {
        name: "kanboard-mcp",
        version: KANBOARD_MCP_VERSION,
        node: process.version,
        target: new URL(parsedEnv.url).host,
        mode: parsedEnv.mode,
      },
      "starting stdio transport",
    );
  } else {
    // DEGRADED mode: no validated env to report. bootstrap() already logged the
    // prominent credential warning; here we note the transport is starting in a
    // listable-but-non-functional state. Still stderr-only (no stdout writes).
    logger.warn(
      {
        name: "kanboard-mcp",
        version: KANBOARD_MCP_VERSION,
        node: process.version,
        degraded: true,
      },
      "starting stdio transport in DEGRADED mode — tools are listable but every call will fail until credentials are fixed",
    );
  }

  // 3. Create the stdio transport.
  const transport = new StdioServerTransport();

  // 4. Graceful shutdown: close the transport before the process exits.
  const shutdown = (): void => {
    logger.info("Received shutdown signal — closing transport");
    transport.close().catch((err: unknown) => {
      logger.error({ err }, "Error closing transport during shutdown");
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    // Set up the closed promise BEFORE connect() so our callback is in place
    // when the transport's internal onclose fires (same pattern as doku-v1).
    const closedPromise = new Promise<void>((resolve) => {
      const prevOnclose = transport.onclose;
      transport.onclose = (): void => {
        prevOnclose?.();
        resolve();
      };
    });

    // 5. Connect the server to the stdio transport.
    //    server.connect() starts the transport and resolves immediately after
    //    transport.start(). We must then await closedPromise to keep the process
    //    alive until the MCP client disconnects (stdin EOF or signal).
    await server.connect(transport);

    // Block here until transport closes.
    await closedPromise;
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    logger.info("kanboard-mcp server stopping");
  }
}
