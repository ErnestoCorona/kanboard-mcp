/**
 * Pino logger factory for kanboard-mcp.
 *
 * Key design constraints:
 * - Output goes to STDERR exclusively (fd 2).
 *   Stdout is the MCP JSON-RPC channel in stdio mode — we NEVER write there.
 * - Kanboard credentials (apiToken, token, password, Authorization header)
 *   are fully redacted before any log line reaches stderr.
 * - JSON output (no pretty-printing) to keep log lines machine-parseable.
 */

import pino from "pino";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Redaction paths — exported so tests can import the SAME list the runtime uses
// ---------------------------------------------------------------------------

/**
 * Pino redaction paths covering all Kanboard credential fields.
 * Tests import this to assert they are using the same list as the runtime.
 */
export const redactionPaths: string[] = [
  "apiToken",
  "*.apiToken",
  "*.token",
  "*.secret",
  "password",
  "*.password",
  "req.headers.authorization",
  "auth.password",
  "credentials.password",
  "credentials.apiToken",
  "headers.authorization",
];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateLoggerOptions {
  /** Pino log level. Defaults to LOG_LEVEL env var or "info". */
  level?: string;
  /**
   * Auth mode — reserved for future startup banner use.
   * Currently unused at the logger level.
   */
  mode?: "personal" | "app";
  /**
   * Additional redaction paths to merge with the defaults.
   * Useful in tests that need extra paths covered.
   */
  redactExtra?: string[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a configured Pino logger that writes JSON to **stderr only**.
 *
 * Stdout is reserved for MCP JSON-RPC frames — this logger never pollutes it.
 *
 * Redaction paths cover at minimum:
 * - `apiToken` and `*.apiToken` (top-level and nested token fields)
 * - `*.token` (any field named `token` in any nested object)
 * - `*.secret` (any field named `secret` in any nested object)
 * - `password` and `*.password` (top-level + any 1-level-nested password field)
 * - `req.headers.authorization` (standard HTTP request log pattern)
 * - `auth.password` and `credentials.password` (explicit, redundant with `*.password` but kept for clarity)
 * - `headers.authorization` (flat header object pattern)
 *
 * Additional paths can be passed via `opts.redactExtra`.
 *
 * @param opts - Optional overrides for level, mode, and extra redaction paths.
 * @returns A fully configured `pino.Logger` instance writing to stderr.
 *
 * @example
 * ```ts
 * const logger = createLogger({ level: "debug" });
 * logger.info({ tool: "create_task", duration_ms: 42 }, "request completed");
 * ```
 */
export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const level = opts.level ?? process.env["LOG_LEVEL"] ?? "info";

  const paths = opts.redactExtra !== undefined ? [...redactionPaths, ...opts.redactExtra] : redactionPaths;

  return pino(
    {
      level,
      redact: {
        paths,
        censor: "[REDACTED]",
      },
    },
    pino.destination(2 /* stderr fd */),
  );
}

export type { Logger };
