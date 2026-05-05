import { describe, it, expect } from "vitest";
import {
  BATCH_TASK_CAP,
  FILE_SIZE_CAP_BYTES,
  DEFAULT_TIMEOUT_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  RETRYABLE_HTTP_STATUSES,
  IDEMPOTENT_METHOD_PREFIXES,
  JSONRPC_ENDPOINT_PATH,
  JSONRPC_USERNAME_APP_MODE,
  KANBOARD_MCP_VERSION,
} from "../../../src/shared/constants.js";

describe("BATCH_TASK_CAP", () => {
  it("is exactly 100 — SPEC contract (OQ-04 resolution, spec wins over design's 50)", () => {
    // If you change this value, re-read the spec (FR-14) before doing so.
    expect(BATCH_TASK_CAP).toBe(100);
  });
});

describe("FILE_SIZE_CAP_BYTES", () => {
  it("is exactly 5 MB (5 * 1024 * 1024 = 5242880)", () => {
    expect(FILE_SIZE_CAP_BYTES).toBe(5 * 1024 * 1024);
  });

  it("is 5242880 bytes", () => {
    expect(FILE_SIZE_CAP_BYTES).toBe(5_242_880);
  });
});

describe("DEFAULT_TIMEOUT_MS", () => {
  it("is 15 seconds (15000 ms)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
  });
});

describe("RETRY_MAX_ATTEMPTS", () => {
  it("is 2", () => {
    expect(RETRY_MAX_ATTEMPTS).toBe(2);
  });

  it("length of RETRY_BACKOFF_MS matches RETRY_MAX_ATTEMPTS", () => {
    // Each attempt needs a corresponding backoff delay — mismatch is a bug.
    expect(RETRY_BACKOFF_MS.length).toBe(RETRY_MAX_ATTEMPTS);
  });
});

describe("RETRY_BACKOFF_MS", () => {
  it("has correct delays [300, 900]", () => {
    expect(RETRY_BACKOFF_MS[0]).toBe(300);
    expect(RETRY_BACKOFF_MS[1]).toBe(900);
  });

  it("backoff delays are in ascending order", () => {
    for (let i = 1; i < RETRY_BACKOFF_MS.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(RETRY_BACKOFF_MS[i]!).toBeGreaterThan(RETRY_BACKOFF_MS[i - 1]!);
    }
  });
});

describe("RETRYABLE_HTTP_STATUSES", () => {
  it("includes 429 (rate limit)", () => {
    expect(RETRYABLE_HTTP_STATUSES).toContain(429);
  });

  it("includes 502, 503, 504 (gateway errors)", () => {
    expect(RETRYABLE_HTTP_STATUSES).toContain(502);
    expect(RETRYABLE_HTTP_STATUSES).toContain(503);
    expect(RETRYABLE_HTTP_STATUSES).toContain(504);
  });

  it("does NOT include 500 (Internal Server Error — not retriable by spec)", () => {
    expect(RETRYABLE_HTTP_STATUSES).not.toContain(500);
  });
});

describe("IDEMPOTENT_METHOD_PREFIXES", () => {
  it("includes get, search, find prefixes", () => {
    expect(IDEMPOTENT_METHOD_PREFIXES).toContain("get");
    expect(IDEMPOTENT_METHOD_PREFIXES).toContain("search");
    expect(IDEMPOTENT_METHOD_PREFIXES).toContain("find");
  });

  it("does NOT include mutation prefixes (create, update, move, add)", () => {
    expect(IDEMPOTENT_METHOD_PREFIXES).not.toContain("create");
    expect(IDEMPOTENT_METHOD_PREFIXES).not.toContain("update");
    expect(IDEMPOTENT_METHOD_PREFIXES).not.toContain("move");
    expect(IDEMPOTENT_METHOD_PREFIXES).not.toContain("add");
  });
});

describe("JSONRPC_ENDPOINT_PATH", () => {
  it("is /jsonrpc.php", () => {
    expect(JSONRPC_ENDPOINT_PATH).toBe("/jsonrpc.php");
  });
});

describe("JSONRPC_USERNAME_APP_MODE", () => {
  it("is the literal string 'jsonrpc'", () => {
    // Kanboard's auth code recognizes this exact string — do not change it.
    expect(JSONRPC_USERNAME_APP_MODE).toBe("jsonrpc");
  });
});

describe("KANBOARD_MCP_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof KANBOARD_MCP_VERSION).toBe("string");
    expect(KANBOARD_MCP_VERSION.length).toBeGreaterThan(0);
  });

  it("falls back to 0.0.0-dev in non-bundled contexts (vitest)", () => {
    // In vitest the tsup define is NOT injected, so we expect the dev fallback.
    expect(KANBOARD_MCP_VERSION).toBe("0.0.0-dev");
  });
});
