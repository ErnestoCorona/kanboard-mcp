/**
 * Shared constants for kanboard-mcp.
 *
 * All timing limits, size caps, retry policy values, and protocol constants
 * live here — no magic numbers anywhere else.
 *
 * `__KANBOARD_MCP_VERSION__` is injected at build time by tsup's `define`
 * option (see tsup.config.ts). Falls back to `"0.0.0-dev"` in non-bundled
 * contexts (e.g. vitest, ts-node) where the define is not injected.
 */

// ---------------------------------------------------------------------------
// Build-time version injection
// ---------------------------------------------------------------------------

// tsup replaces this declaration with the literal version string at bundle time.
declare const __KANBOARD_MCP_VERSION__: string;

function _resolveVersion(): string {
  try {
    // typeof check prevents ReferenceError in environments where tsup's define
    // hasn't run (vitest, ts-node, etc.).
    return typeof __KANBOARD_MCP_VERSION__ === "string" ? __KANBOARD_MCP_VERSION__ : "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

/**
 * Version of the kanboard-mcp package, injected at build time from package.json.
 * Falls back to `"0.0.0-dev"` in non-bundled contexts.
 */
export const KANBOARD_MCP_VERSION: string = _resolveVersion();

// ---------------------------------------------------------------------------
// Network / timeout
// ---------------------------------------------------------------------------

/** Default per-request timeout in milliseconds. Override via KANBOARD_TIMEOUT_MS env var. */
export const DEFAULT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Batch task creation cap
// ---------------------------------------------------------------------------

/**
 * Maximum number of items allowed in a single `create_tasks_batch` call.
 *
 * SPEC CONTRACT (OQ-04 resolution): this is 100 per spec FR-14 (1..100).
 * The design artifact §1f originally had 50 — the spec wins.
 * If you change this value, the constants.test.ts assertion will fail loudly.
 */
export const BATCH_TASK_CAP = 100;

// ---------------------------------------------------------------------------
// File attachment cap
// ---------------------------------------------------------------------------

/**
 * Maximum decoded file size in bytes for `attach_file_to_task`.
 * Enforced BEFORE base64 encoding and BEFORE any HTTP request.
 * Maps to the 5 MB cap documented in FR-15.
 */
export const FILE_SIZE_CAP_BYTES = 5 * 1024 * 1024; // 5,242,880 bytes

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts for idempotent reads (total = attempts + 1 initial). */
export const RETRY_MAX_ATTEMPTS = 2;

/**
 * Backoff delays in milliseconds between retry attempts.
 * Index 0 = delay before attempt 2, index 1 = delay before attempt 3.
 * Length MUST equal RETRY_MAX_ATTEMPTS — constants.test.ts enforces this.
 */
export const RETRY_BACKOFF_MS = [300, 900] as const;

/** HTTP status codes that trigger a retry for idempotent read methods. */
export const RETRYABLE_HTTP_STATUSES = [429, 502, 503, 504] as const;

// ---------------------------------------------------------------------------
// Method name prefixes used to decide retry eligibility
// ---------------------------------------------------------------------------

/**
 * JSON-RPC method name prefixes that identify idempotent (read-only) calls.
 * The api-client uses these to decide whether a failed request should be retried.
 * Mutations (`createX`, `updateX`, `moveX`, `addX`) are NEVER retried.
 */
export const IDEMPOTENT_METHOD_PREFIXES = ["get", "search", "find"] as const;

// ---------------------------------------------------------------------------
// JSON-RPC protocol constants
// ---------------------------------------------------------------------------

/** Path appended to KANBOARD_URL for all JSON-RPC requests. */
export const JSONRPC_ENDPOINT_PATH = "/jsonrpc.php" as const;

/**
 * Literal username used in HTTP Basic auth when `mode === "app"`.
 * Kanboard's auth code recognizes this exact string to bypass normal user lookup.
 */
export const JSONRPC_USERNAME_APP_MODE = "jsonrpc" as const;
