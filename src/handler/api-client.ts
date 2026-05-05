/**
 * Low-level JSON-RPC 2.0 transport for the Kanboard API.
 *
 * Responsibilities:
 * - Single POST endpoint: `${config.url}/jsonrpc.php`
 * - HTTP Basic auth header construction (mode-aware: personal / app)
 * - JSON-RPC 2.0 envelope construction (single call and batch array)
 * - Timeout via AbortSignal.timeout() — per-attempt, each retry gets its own signal
 * - Retry policy: idempotent methods only (get*, search*, find*), max 2 retries
 * - Exponential backoff: [300ms, 900ms]
 * - HTTP error → typed error mapping (two levels: transport + JSON-RPC)
 * - Batch response alignment by id (Kanboard may return results out of order)
 * - Logging (safe: only method name, param keys — NEVER the full params or auth header)
 *
 * This class is intentionally method-agnostic. It does NOT know about
 * Kanboard's `null`/`false` result semantics — those live in `kanboard.ts`.
 */

import type { Logger } from "pino";
import {
  KanboardApiError,
  AuthError,
  TimeoutError,
  ConfigError,
} from "../shared/errors.js";
import type { KanboardConfig, BatchCall, BatchResult } from "../shared/types.js";
import {
  DEFAULT_TIMEOUT_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  RETRYABLE_HTTP_STATUSES,
  IDEMPOTENT_METHOD_PREFIXES,
  JSONRPC_ENDPOINT_PATH,
  JSONRPC_USERNAME_APP_MODE,
} from "../shared/constants.js";
import { createLogger } from "../shared/logger.js";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/**
 * Options passed to the ApiClient constructor.
 *
 * @param config  - Kanboard connection config (url, apiToken, mode, username?, timeoutMs?).
 *                  In personal mode, `config.username` MUST be set; otherwise ConfigError is thrown.
 *                  In app mode, `config.username` is ignored — the literal "jsonrpc" is used.
 * @param logger  - Optional Pino logger injection (used in tests). Defaults to createLogger().
 * @param fetchImpl - Optional fetch implementation injection (used with undici MockAgent in tests).
 *                  Defaults to global fetch.
 */
export interface ApiClientOptions {
  config: KanboardConfig;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Internal JSON-RPC envelope shapes
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isJsonRpcError(v: unknown): v is JsonRpcErrorResponse {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    typeof (v as Record<string, unknown>)["error"] === "object"
  );
}

function isJsonRpcSuccess<T>(v: unknown): v is JsonRpcSuccessResponse<T> {
  return (
    typeof v === "object" &&
    v !== null &&
    "result" in v &&
    !("error" in v)
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if the JSON-RPC method is idempotent (read-only) and safe to retry.
 * Decision is driven by method name prefix per NFR-Retry and constants.ts.
 */
function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix));
}

/**
 * Returns true if the HTTP status code triggers a retry for idempotent methods.
 */
function isRetryableStatus(status: number): boolean {
  return (RETRYABLE_HTTP_STATUSES as readonly number[]).includes(status);
}

/**
 * Parse the Retry-After header as seconds, capped at 30s.
 * Returns undefined when the header is absent or unparseable.
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const parsed = parseInt(header, 10);
  if (isNaN(parsed) || parsed < 0) return undefined;
  return Math.min(parsed, 30);
}

// ---------------------------------------------------------------------------
// ApiClient
// ---------------------------------------------------------------------------

/**
 * Low-level JSON-RPC 2.0 transport client for Kanboard.
 *
 * Auth mode contract:
 * - `mode === "personal"`: `config.username` MUST be non-empty — throws `ConfigError` on ctor.
 * - `mode === "app"`: username is forced to `JSONRPC_USERNAME_APP_MODE` ("jsonrpc");
 *   `config.username` if present is silently ignored.
 *
 * This class is intentionally unaware of Kanboard's per-method result semantics
 * (null / false). Those are handled upstream in `kanboard.ts`.
 */
export class ApiClient {
  readonly #endpoint: string;
  readonly #authHeader: string;
  readonly #defaultTimeoutMs: number;
  readonly #logger: Logger;
  readonly #fetch: typeof fetch;
  #callId = 0;

  public constructor(opts: ApiClientOptions) {
    const { config } = opts;

    // Resolve username based on auth mode
    let username: string;
    if (config.mode === "app") {
      username = JSONRPC_USERNAME_APP_MODE;
    } else {
      // personal mode: username is mandatory
      if (!config.username) {
        throw new ConfigError("KANBOARD_USERNAME required for personal mode");
      }
      username = config.username;
    }

    const normalized = config.url.replace(/\/+$/, "");
    this.#endpoint = `${normalized}${JSONRPC_ENDPOINT_PATH}`;
    this.#authHeader = `Basic ${Buffer.from(`${username}:${config.apiToken}`).toString("base64")}`;
    this.#defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#logger = opts.logger ?? createLogger();
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Execute a single JSON-RPC call and return the `result` field.
   *
   * - Returns `result` as-is, including `null` and `false`. Semantic interpretation
   *   of those values is the responsibility of the caller (`kanboard.ts`).
   * - Throws `AuthError` on HTTP 401/403.
   * - Throws `TimeoutError` on AbortSignal / network abort.
   * - Throws `KanboardApiError` on other HTTP errors or JSON-RPC `error` body.
   * - Retries on transient errors (429, 502–504, network) for idempotent methods only.
   *
   * @param method - JSON-RPC method name (e.g. "getTask", "createTask").
   * @param params - Optional JSON-RPC params object.
   * @returns The `result` field from the JSON-RPC success envelope.
   */
  public async call<TResult>(method: string, params?: unknown): Promise<TResult> {
    const idempotent = isIdempotentMethod(method);
    const maxAttempts = idempotent ? 1 + RETRY_MAX_ATTEMPTS : 1;

    this.#logger.debug(
      { method, paramsKeys: params != null && typeof params === "object" && !Array.isArray(params)
          ? Object.keys(params as Record<string, unknown>)
          : [] },
      "json-rpc call starting",
    );

    let lastError: KanboardApiError | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 900;
        this.#logger.warn({ method, attempt, delayMs: delay }, "retrying json-rpc call");
        await sleep(delay);
      }

      const requestId = ++this.#callId;
      const body = this.#buildSingleBody(method, params, requestId);

      try {
        const raw = await this.#doFetch(body, method);

        // Validate single-call response shape
        if (Array.isArray(raw)) {
          const err = new KanboardApiError(
            method,
            "Response shape mismatch: expected single envelope, got array",
            { code: -32700 },
          );
          this.#logger.error({ method, code: -32700, message: err.message }, "json-rpc shape error");
          throw err;
        }

        if (!isObject(raw)) {
          const err = new KanboardApiError(method, "Server returned non-JSON response", { code: -32700 });
          this.#logger.error({ method, code: -32700, message: err.message }, "json-rpc parse error");
          throw err;
        }

        const envelope = raw as unknown as JsonRpcResponse<TResult>;

        // Validate id matches
        if (envelope.id !== requestId) {
          const err = new KanboardApiError(method, "Mismatched request id", { code: -32700 });
          this.#logger.error({ method, code: -32700, message: err.message }, "json-rpc id mismatch");
          throw err;
        }

        if (isJsonRpcError(envelope)) {
          const rpcErr = envelope.error;
          const err = new KanboardApiError(method, rpcErr.message, { code: rpcErr.code });
          this.#logger.error({ method, code: rpcErr.code, message: rpcErr.message }, "json-rpc error response");
          // JSON-RPC app-level errors are NOT transient — no retry
          throw err;
        }

        if (isJsonRpcSuccess<TResult>(envelope)) {
          return envelope.result;
        }

        // Malformed envelope (no result, no error)
        const err = new KanboardApiError(method, "Server returned non-JSON response", { code: -32700 });
        this.#logger.error({ method, code: -32700, message: err.message }, "json-rpc malformed envelope");
        throw err;

      } catch (err) {
        if (err instanceof TimeoutError || err instanceof AuthError) {
          // Never retry these
          throw err;
        }

        if (err instanceof KanboardApiError) {
          // Check if we should retry (HTTP transport errors only, not JSON-RPC app errors)
          // We retry if: idempotent + has retryable cause + not last attempt
          const isTransport = this.#isTransportError(err);
          if (idempotent && isTransport && attempt < maxAttempts - 1) {
            lastError = err;
            continue;
          }
          this.#logger.error({ method, code: err.code, message: err.message }, "json-rpc call failed");
          throw err;
        }

        throw err;
      }
    }

    // Exhausted retries
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    throw lastError!;
  }

  /**
   * Execute a JSON-RPC 2.0 batch request.
   *
   * - Sends a single POST with an array body.
   * - Aligns response items to input order by `id` (Kanboard may return out of order).
   * - Returns a `BatchResult[]` — one entry per input call.
   * - Retries the whole batch on transient errors only if ALL calls are idempotent.
   * - Never retries batches containing mutations.
   *
   * @param calls - Array of BatchCall items. The `id` field of each call is used
   *   as its index key for response alignment.
   * @returns Array of BatchResult, aligned to input order.
   */
  public async batch(calls: BatchCall[]): Promise<BatchResult<unknown>[]> {
    if (calls.length === 0) return [];

    const allIdempotent = calls.every((c) => isIdempotentMethod(c.method));
    const maxAttempts = allIdempotent ? 1 + RETRY_MAX_ATTEMPTS : 1;

    this.#logger.debug(
      { methods: calls.map((c) => c.method), count: calls.length },
      "json-rpc batch starting",
    );

    let lastError: KanboardApiError | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 900;
        this.#logger.warn({ count: calls.length, attempt, delayMs: delay }, "retrying json-rpc batch");
        await sleep(delay);
      }

      const body = this.#buildBatchBody(calls);
      // Use the first method name for error context
      const methodCtx = calls[0]?.method ?? "batch";

      try {
        const raw = await this.#doFetch(body, methodCtx);

        // Must be an array
        if (!Array.isArray(raw)) {
          const err = new KanboardApiError(
            methodCtx,
            "Response shape mismatch: expected array for batch, got single envelope",
            { code: -32700 },
          );
          this.#logger.error({ code: -32700, message: err.message }, "json-rpc batch shape error");
          throw err;
        }

        // Align by id and build BatchResult[]
        return this.#alignBatchResponse(calls, raw);

      } catch (err) {
        if (err instanceof TimeoutError || err instanceof AuthError) {
          throw err;
        }

        if (err instanceof KanboardApiError) {
          const isTransport = this.#isTransportError(err);
          if (allIdempotent && isTransport && attempt < maxAttempts - 1) {
            lastError = err;
            continue;
          }
          this.#logger.error({ code: err.code, message: err.message }, "json-rpc batch failed");
          throw err;
        }

        throw err;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    throw lastError!;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the JSON-RPC request body for a single call.
   */
  #buildSingleBody(method: string, params: unknown, id: number): string {
    const envelope: JsonRpcRequest = { jsonrpc: "2.0", id, method };
    if (params !== undefined) {
      envelope.params = params;
    }
    return JSON.stringify(envelope);
  }

  /**
   * Build the JSON-RPC request body for a batch of calls.
   */
  #buildBatchBody(calls: BatchCall[]): string {
    const envelopes: JsonRpcRequest[] = calls.map((c) => {
      const env: JsonRpcRequest = { jsonrpc: "2.0", id: c.id, method: c.method };
      if (Object.keys(c.params).length > 0) {
        env.params = c.params;
      }
      return env;
    });
    return JSON.stringify(envelopes);
  }

  /**
   * Execute a single POST fetch to the JSON-RPC endpoint.
   * Handles timeout, network errors, and HTTP-level error mapping.
   * Returns the parsed JSON body (type unknown — caller validates shape).
   */
  async #doFetch(body: string, methodCtx: string): Promise<unknown> {
    let res: Response;

    try {
      res = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: this.#authHeader,
        },
        body,
        signal: AbortSignal.timeout(this.#defaultTimeoutMs),
      });
    } catch (err) {
      // Network error or AbortSignal.timeout() fired
      const isTimeout =
        (err instanceof DOMException && err.name === "TimeoutError") ||
        (err instanceof Error && err.name === "TimeoutError");
      if (isTimeout) {
        const te = new TimeoutError(methodCtx, `Request timed out after ${String(this.#defaultTimeoutMs)}ms`, { cause: err });
        throw te;
      }
      // Other network errors (ECONNREFUSED, etc.) — treat as transient
      const ne = new KanboardApiError(methodCtx, `Network error: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      throw ne;
    }

    // HTTP-level error handling
    if (!res.ok) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfter = parseRetryAfter(retryAfterHeader);

      if (res.status === 401 || res.status === 403) {
        const err = new AuthError(methodCtx, `HTTP ${String(res.status)} Unauthorized/Forbidden`, { cause: undefined });
        throw err;
      }

      if (res.status === 404) {
        throw new KanboardApiError(methodCtx, "Endpoint not found", { code: 404 });
      }

      if (res.status === 429) {
        const retryAfterOpt = retryAfter !== undefined ? { retryAfter } : {};
        throw new KanboardApiError(methodCtx, "Rate limited", { code: 429, ...retryAfterOpt });
      }

      // 5xx
      throw new KanboardApiError(
        methodCtx,
        `HTTP ${String(res.status)} error`,
        { code: res.status },
      );
    }

    // Parse JSON body
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (err) {
      throw new KanboardApiError(
        methodCtx,
        "Server returned non-JSON response",
        { code: -32700, cause: err },
      );
    }

    return parsed;
  }

  /**
   * Align a batch response array to the input calls order by matching on `id`.
   * Kanboard does not guarantee response order — this method sorts and maps.
   */
  #alignBatchResponse(calls: BatchCall[], responses: unknown[]): BatchResult<unknown>[] {
    // Build a lookup map: response id → response object
    const byId = new Map<number, unknown>();
    for (const resp of responses) {
      if (isObject(resp) && typeof resp["id"] === "number") {
        byId.set(resp["id"], resp);
      }
    }

    return calls.map((call) => {
      const resp = byId.get(call.id);
      if (resp === undefined) {
        // Missing response for this call id
        return {
          ok: false as const,
          index: call.id,
          error: { code: -32700, message: `No response for call id ${String(call.id)}` },
        };
      }

      if (isJsonRpcError(resp)) {
        return {
          ok: false as const,
          index: call.id,
          error: { code: resp.error.code, message: resp.error.message },
        };
      }

      if (isJsonRpcSuccess(resp)) {
        return {
          ok: true as const,
          index: call.id,
          result: resp.result,
        };
      }

      // Malformed response item
      return {
        ok: false as const,
        index: call.id,
        error: { code: -32700, message: "Malformed batch response item" },
      };
    });
  }

  /**
   * Determine if a KanboardApiError is a transport-level error (suitable for retry).
   * Application-level JSON-RPC errors (negative codes) are NOT transport errors.
   *
   * Transport errors: HTTP 429, 5xx, network errors.
   * NOT transport: JSON-RPC app errors (code < 0), 401, 403, 404.
   */
  #isTransportError(err: KanboardApiError): boolean {
    if (err instanceof AuthError) return false;
    if (err instanceof TimeoutError) return false;
    const code = err.code;
    if (code === undefined) {
      // Network error (no code) — transient
      return true;
    }
    // HTTP status codes in retryable range
    if (isRetryableStatus(code)) return true;
    // Negative codes are JSON-RPC app errors — not transient
    if (code < 0) return false;
    return false;
  }
}
