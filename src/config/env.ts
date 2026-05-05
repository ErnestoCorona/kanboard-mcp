/**
 * Environment variable loader for kanboard-mcp.
 *
 * Call `loadEnv()` at startup. On missing or invalid vars it throws a
 * `ConfigError` with a clear, action-oriented message so the entry point can
 * exit(1) before registering any tool or making any network call (FR-01, S5).
 *
 * Security contract:
 * - The value of KANBOARD_API_TOKEN is NEVER included in any error message
 *   or log line — only the env var NAME is referenced.
 * - `username` is always populated in the returned config (resolved per mode).
 */

import { z } from "zod";
import { ConfigError } from "../shared/errors.js";
import { DEFAULT_TIMEOUT_MS, JSONRPC_USERNAME_APP_MODE } from "../shared/constants.js";
import type { KanboardAuthMode, KanboardConfig } from "../shared/types.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PINO_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type PinoLevel = (typeof PINO_LEVELS)[number];

const AUTH_MODES: readonly string[] = ["personal", "app"] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validates a URL string: must be a valid http or https URL.
 * Trailing slashes are normalized away.
 * Returns the normalised URL string or throws ConfigError.
 */
function validateUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(
      `KANBOARD_URL is not a valid URL. ` +
        `Received an unparseable value. ` +
        `Set KANBOARD_URL to a valid http or https URL (e.g. https://pm.example.com).`,
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError(
      `KANBOARD_URL must be an http or https URL. ` +
        `Got protocol: "${url.protocol}". Example: https://pm.example.com`,
    );
  }

  // Strip trailing slash(es)
  return raw.replace(/\/+$/, "");
}

/**
 * Validates KANBOARD_TIMEOUT_MS: must be a positive integer string.
 * Returns the parsed number or throws ConfigError.
 */
function validateTimeoutMs(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(
      `KANBOARD_TIMEOUT_MS must be a positive integer (milliseconds). ` +
        `Received: "${raw}". Example: 15000`,
    );
  }
  return parsed;
}

/**
 * Validates KANBOARD_API_TOKEN: must be at minimum 16 characters (heuristic).
 * NOTE: The token VALUE is never included in error messages — only the var name.
 */
function validateToken(raw: string): string {
  if (raw.length < 16) {
    throw new ConfigError(
      `KANBOARD_API_TOKEN appears to be too short (minimum 16 characters). ` +
        `Check that the correct token value is set in KANBOARD_API_TOKEN.`,
    );
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Parsed env result (superset of KanboardConfig)
// ---------------------------------------------------------------------------

/**
 * Full parsed environment — includes KanboardConfig fields plus extras
 * (log level) that don't belong on the config type but are needed at startup.
 */
export interface ParsedEnv extends KanboardConfig {
  /** Resolved username — always set regardless of auth mode. */
  username: string;
  /** Pino log level, default "info". */
  logLevel: PinoLevel;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Read and validate all environment variables required by kanboard-mcp.
 *
 * Branches on `KANBOARD_AUTH_MODE`:
 * - `"personal"` (default): requires `KANBOARD_URL`, `KANBOARD_API_TOKEN`,
 *   `KANBOARD_USERNAME`. Returns config with `username` set to the env value.
 * - `"app"`: requires `KANBOARD_URL`, `KANBOARD_API_TOKEN`. `KANBOARD_USERNAME`
 *   is optional and ignored (forced to literal `"jsonrpc"`).
 *
 * All failures throw `ConfigError` with action-oriented messages.
 * Token values are NEVER included in error messages.
 *
 * @param env - Process environment object (defaults to `process.env`).
 * @returns Validated {@link ParsedEnv} (a superset of `KanboardConfig`).
 * @throws {ConfigError} on any missing or invalid variable.
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): ParsedEnv {
  // --- 1. KANBOARD_AUTH_MODE (default "personal") --------------------------

  const rawMode = env["KANBOARD_AUTH_MODE"] ?? "personal";
  if (!AUTH_MODES.includes(rawMode)) {
    throw new ConfigError(
      `KANBOARD_AUTH_MODE has an invalid value: "${rawMode}". ` +
        `Valid values are: "personal", "app". ` +
        `Set KANBOARD_AUTH_MODE to one of these values (or omit it to default to "personal").`,
    );
  }
  const mode = rawMode as KanboardAuthMode;

  // --- 2. KANBOARD_URL (always required) -----------------------------------

  const rawUrl = env["KANBOARD_URL"];
  if (rawUrl === undefined || rawUrl.trim() === "") {
    throw new ConfigError(
      `KANBOARD_URL is required but was not set. ` +
        `Set KANBOARD_URL to the base URL of your Kanboard instance (e.g. https://pm.example.com).`,
    );
  }
  const url = validateUrl(rawUrl.trim());

  // --- 3. KANBOARD_API_TOKEN (always required) ------------------------------

  const rawToken = env["KANBOARD_API_TOKEN"];
  if (rawToken === undefined || rawToken.trim() === "") {
    throw new ConfigError(
      `KANBOARD_API_TOKEN is required but was not set. ` +
        `Set KANBOARD_API_TOKEN to your Kanboard API token.`,
    );
  }
  const apiToken = validateToken(rawToken.trim());

  // --- 4. Username resolution (mode-dependent) ------------------------------

  let username: string;

  if (mode === "personal") {
    const rawUsername = env["KANBOARD_USERNAME"];
    if (rawUsername === undefined || rawUsername.trim() === "") {
      throw new ConfigError(
        `KANBOARD_USERNAME is required when KANBOARD_AUTH_MODE=personal. ` +
          `Set KANBOARD_USERNAME to your Kanboard login username for personal mode.`,
      );
    }
    username = rawUsername.trim();
  } else {
    // mode === "app": username is forced to the jsonrpc system user
    const rawUsername = env["KANBOARD_USERNAME"];
    if (rawUsername !== undefined && rawUsername.trim() !== "") {
      logger.warn(
        { envVar: "KANBOARD_USERNAME" },
        `KANBOARD_USERNAME is set but will be ignored in app mode — ` +
          `username is forced to "${JSONRPC_USERNAME_APP_MODE}"`,
      );
    }
    username = JSONRPC_USERNAME_APP_MODE;
  }

  // --- 5. KANBOARD_TIMEOUT_MS (optional, defaults to DEFAULT_TIMEOUT_MS) ---

  let timeoutMs: number = DEFAULT_TIMEOUT_MS;
  const rawTimeout = env["KANBOARD_TIMEOUT_MS"];
  if (rawTimeout !== undefined && rawTimeout.trim() !== "") {
    timeoutMs = validateTimeoutMs(rawTimeout.trim());
  }

  // --- 6. LOG_LEVEL (optional, default "info") ------------------------------

  const rawLogLevel = env["LOG_LEVEL"] ?? "info";
  const logLevelSchema = z.enum(PINO_LEVELS);
  const logLevelResult = logLevelSchema.safeParse(rawLogLevel);
  if (!logLevelResult.success) {
    throw new ConfigError(
      `LOG_LEVEL has an invalid value: "${rawLogLevel}". ` +
        `Valid values are: ${PINO_LEVELS.map((l) => `"${l}"`).join(", ")}.`,
    );
  }
  const logLevel: PinoLevel = logLevelResult.data;

  // --- Build and return result ----------------------------------------------

  return {
    url,
    apiToken,
    mode,
    username,
    timeoutMs,
    logLevel,
  };
}
