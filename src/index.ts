/**
 * CLI entry point for kanboard-mcp.
 *
 * Delegates all work to the stdio transport. If runStdio() rejects (e.g.
 * ConfigError from missing env vars, or any unexpected runtime error), we
 * print a death-rattle to stderr and exit non-zero. We use console.error here
 * only because the Pino logger may not be available if env loading itself failed.
 *
 * Stdout is reserved for MCP JSON-RPC frames — never written here.
 */

import { runStdio } from "./transports/stdio.js";

runStdio().catch((err: unknown) => {
  // Logger may not be available if env loading itself failed.
  // Fall back to console.error (no Pino) for the death-rattle.
  console.error(
    "[kanboard-mcp] fatal:",
    err instanceof Error ? err.message : String(err),
  );
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
