/**
 * Typed error hierarchy for kanboard-mcp.
 *
 * All errors extend KanboardApiError (base), which carries the JSON-RPC
 * method name, an optional numeric code, and an optional cause.
 *
 * Each class exposes:
 * - A `name` property set to the class name (stable for logging / JSON.stringify).
 * - A static `is(err)` predicate for safe narrowing without `instanceof` fragility.
 * - A `toMcpToolResult()` method that shapes the error into an MCP ToolResult.
 */

// ---------------------------------------------------------------------------
// MCP ToolResult error shape
// ---------------------------------------------------------------------------

export interface McpToolResultError {
  isError: true;
  content: { type: "text"; text: string }[];
}

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

export interface KanboardApiErrorOptions {
  /** Numeric JSON-RPC error code, when applicable. */
  code?: number;
  /** Original cause (chained error). */
  cause?: unknown;
  /** Retry-After seconds parsed from HTTP header (429 only). */
  retryAfter?: number;
}

/**
 * Base class for all Kanboard MCP errors.
 *
 * Carries the JSON-RPC `method` that triggered the error, an optional numeric
 * `code`, and an optional `cause` for error chaining.
 */
export class KanboardApiError extends Error {
  // Declared as string (not a literal) so subclasses can narrow to their own name
  // without violating TS2416. Each subclass assigns its own class name string.
  public override readonly name: string = "KanboardApiError";
  public readonly method: string;
  public readonly code: number | undefined;
  public readonly retryAfter: number | undefined;

  public constructor(method: string, message: string, opts: KanboardApiErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : {});
    this.method = method;
    this.code = opts.code;
    this.retryAfter = opts.retryAfter;

    // Maintain correct prototype chain in compiled output.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Type predicate — true when `err` is any KanboardApiError instance
   * (including subclasses).
   */
  public static is(err: unknown): err is KanboardApiError {
    return err instanceof KanboardApiError;
  }

  /**
   * Shape this error into an MCP ToolResult with `isError: true`.
   * Tools call this to produce a uniform error response.
   */
  public toMcpToolResult(): McpToolResultError {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `API_ERROR [${this.method}]: ${this.message}`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// AuthError — HTTP 401/403 or getMe() cache failure
// ---------------------------------------------------------------------------

/**
 * Thrown when Kanboard returns HTTP 401 / 403, or when `getMe()` fails due to
 * an invalid token. Tools that need the getMe cache will surface this.
 */
export class AuthError extends KanboardApiError {
  public override readonly name = "AuthError";

  public constructor(method: string, message: string, opts: KanboardApiErrorOptions = {}) {
    super(method, message, opts);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static override is(err: unknown): err is AuthError {
    return err instanceof AuthError;
  }

  public override toMcpToolResult(): McpToolResultError {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `AUTH_ERROR [${this.method}]: ${this.message}`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// NotFoundError — null returns from Kanboard getters
// ---------------------------------------------------------------------------

/**
 * Thrown when a Kanboard getter returns `null`, meaning the entity does not
 * exist on the server. Maps to `NOT_FOUND` in MCP tool responses.
 */
export class NotFoundError extends KanboardApiError {
  public override readonly name = "NotFoundError";

  public constructor(method: string, message: string, opts: KanboardApiErrorOptions = {}) {
    super(method, message, opts);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static override is(err: unknown): err is NotFoundError {
    return err instanceof NotFoundError;
  }

  public override toMcpToolResult(): McpToolResultError {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `NOT_FOUND [${this.method}]: ${this.message}`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// ValidationError — Zod failures, JSON-RPC -32602, Kanboard 422
// ---------------------------------------------------------------------------

/**
 * Thrown when Zod input validation fails, when Kanboard returns a JSON-RPC
 * `-32602 Invalid params` error, or when pre-flight checks (e.g. file size)
 * fail before any HTTP request is sent.
 *
 * `details` typically contains `ZodIssue[]` or a descriptive object.
 */
export class ValidationError extends KanboardApiError {
  public override readonly name = "ValidationError";
  public readonly details: unknown;

  public constructor(
    method: string,
    message: string,
    details?: unknown,
    opts: KanboardApiErrorOptions = {},
  ) {
    super(method, message, opts);
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static override is(err: unknown): err is ValidationError {
    return err instanceof ValidationError;
  }

  public override toMcpToolResult(): McpToolResultError {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `VALIDATION_ERROR [${this.method}]: ${this.message}`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// ConfigError — env var problems and .kanboard.yaml problems
// ---------------------------------------------------------------------------

/**
 * Thrown when required env vars are missing, have invalid values, or when
 * `.kanboard.yaml` fails schema validation or is unreadable.
 * Does NOT extend KanboardApiError — config failures are not API-level.
 */
export class ConfigError extends Error {
  public override readonly name = "ConfigError";
  public readonly details: unknown;

  public constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static is(err: unknown): err is ConfigError {
    return err instanceof ConfigError;
  }

  public toMcpToolResult(): McpToolResultError {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `CONFIG_ERROR: ${this.message}`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// TimeoutError — AbortSignal.timeout() triggered
// ---------------------------------------------------------------------------

/**
 * Thrown when a fetch request exceeds the configured timeout via
 * `AbortSignal.timeout()`. Distinct from generic network errors.
 */
export class TimeoutError extends KanboardApiError {
  public override readonly name = "TimeoutError";

  public constructor(method: string, message: string, opts: KanboardApiErrorOptions = {}) {
    super(method, message, opts);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public static override is(err: unknown): err is TimeoutError {
    return err instanceof TimeoutError;
  }

  public override toMcpToolResult(): McpToolResultError {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `TIMEOUT_ERROR [${this.method}]: ${this.message}`,
        },
      ],
    };
  }
}
