/**
 * Unit tests for src/handler/api-client.ts
 *
 * HTTP mocking: undici MockAgent (interceptor-per-request style).
 * Fake timers: vi.useFakeTimers() for backoff verification.
 * Fixtures use placeholder tokens only — no real credentials.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import type { Dispatcher } from "undici";
import { ApiClient } from "../../../src/handler/api-client.js";
import {
  KanboardApiError,
  AuthError,
  TimeoutError,
  ConfigError,
} from "../../../src/shared/errors.js";
import type { KanboardConfig, BatchCall } from "../../../src/shared/types.js";
import { createLogger } from "../../../src/shared/logger.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASE_URL = "http://kanboard.test";
const TOKEN = "TEST-TOKEN-aaaa1111";
const USERNAME = "alice";

function makeConfig(overrides: Partial<KanboardConfig> = {}): KanboardConfig {
  return {
    url: BASE_URL,
    apiToken: TOKEN,
    mode: "personal",
    username: USERNAME,
    ...overrides,
  };
}

/** Build the expected Basic auth header for a given username:token pair. */
function basicAuth(user: string, token: string): string {
  return `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
}

/** Convenience: build a JSON-RPC success response envelope. */
function rpcOk(id: number, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

/** Convenience: build a JSON-RPC error response envelope. */
function rpcErr(id: number, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// MockAgent setup
// ---------------------------------------------------------------------------

let agent: MockAgent;
let pool: ReturnType<MockAgent["get"]>;
let originalDispatcher: Dispatcher;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  pool = agent.get(BASE_URL);
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(originalDispatcher);
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper: build an ApiClient that uses the MockAgent via global fetch
// (undici MockAgent intercepts global fetch when set as global dispatcher)
// ---------------------------------------------------------------------------

function makeClient(config?: Partial<KanboardConfig>): ApiClient {
  const silentLogger = createLogger({ level: "silent" });
  return new ApiClient({ config: makeConfig(config), logger: silentLogger });
}

// ---------------------------------------------------------------------------
// 1. Auth header construction
// ---------------------------------------------------------------------------

describe("Auth header — personal mode", () => {
  it("sends Basic base64(username:token) for personal mode", async () => {
    let capturedAuth = "";
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, (opts) => {
        const h = opts.headers as Record<string, string>;
        capturedAuth = h["Authorization"] ?? h["authorization"] ?? "";
        return JSON.stringify(rpcOk(1, "1.2.3"));
      }, { headers: { "Content-Type": "application/json" } });

    const client = makeClient({ mode: "personal", username: USERNAME });
    await client.call("getVersion");

    expect(capturedAuth).toBe(basicAuth(USERNAME, TOKEN));
  });

  it("uses the exact config.username — not 'jsonrpc'", async () => {
    let capturedAuth = "";
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, (opts) => {
        const h = opts.headers as Record<string, string>;
        capturedAuth = h["Authorization"] ?? h["authorization"] ?? "";
        return JSON.stringify(rpcOk(1, "1.2.3"));
      }, { headers: { "Content-Type": "application/json" } });

    const client = makeClient({ mode: "personal", username: "bob" });
    await client.call("getVersion");

    expect(capturedAuth).toBe(basicAuth("bob", TOKEN));
    expect(capturedAuth).not.toContain("jsonrpc");
  });
});

describe("Auth header — app mode", () => {
  it("sends Basic base64(jsonrpc:token) regardless of config.username", async () => {
    let capturedAuth = "";
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, (opts) => {
        const h = opts.headers as Record<string, string>;
        capturedAuth = h["Authorization"] ?? h["authorization"] ?? "";
        return JSON.stringify(rpcOk(1, "1.2.3"));
      }, { headers: { "Content-Type": "application/json" } });

    const client = makeClient({ mode: "app", username: "ignored-user" });
    await client.call("getVersion");

    expect(capturedAuth).toBe(basicAuth("jsonrpc", TOKEN));
  });

  it("works without config.username in app mode", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify(rpcOk(1, "1.2.3")), { headers: { "Content-Type": "application/json" } });

    // Should not throw even without username in app mode
    const client = new ApiClient({
      config: { url: BASE_URL, apiToken: TOKEN, mode: "app" },
      logger: createLogger({ level: "silent" }),
    });
    const result = await client.call("getVersion");
    expect(result).toBe("1.2.3");
  });
});

describe("Auth mode validation", () => {
  it("throws ConfigError when personal mode has no username", () => {
    expect(() => {
      new ApiClient({
        config: { url: BASE_URL, apiToken: TOKEN, mode: "personal" },
        logger: createLogger({ level: "silent" }),
      });
    }).toThrow(ConfigError);
  });

  it("throws ConfigError with clear message about KANBOARD_USERNAME", () => {
    expect(() => {
      new ApiClient({
        config: { url: BASE_URL, apiToken: TOKEN, mode: "personal" },
        logger: createLogger({ level: "silent" }),
      });
    }).toThrow("KANBOARD_USERNAME required for personal mode");
  });

  it("throws ConfigError when personal mode has empty string username", () => {
    expect(() => {
      new ApiClient({
        config: { url: BASE_URL, apiToken: TOKEN, mode: "personal", username: "" },
        logger: createLogger({ level: "silent" }),
      });
    }).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// 2. Single call — happy path
// ---------------------------------------------------------------------------

describe("Single call — happy path", () => {
  it("POSTs to /jsonrpc.php with correct body shape", async () => {
    let capturedBody: Record<string, unknown> = {};
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, (opts) => {
        capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return JSON.stringify(rpcOk(1, 42));
      }, { headers: { "Content-Type": "application/json" } });

    await makeClient().call("getTask", { task_id: 1 });

    expect(capturedBody["jsonrpc"]).toBe("2.0");
    expect(capturedBody["method"]).toBe("getTask");
    expect(capturedBody["params"]).toEqual({ task_id: 1 });
    expect(typeof capturedBody["id"]).toBe("number");
  });

  it("returns the result field of the JSON-RPC envelope", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify(rpcOk(1, { id: 7, title: "My Task" })), { headers: { "Content-Type": "application/json" } });

    const result = await makeClient().call<{ id: number; title: string }>("getTask", { task_id: 7 });
    expect(result).toEqual({ id: 7, title: "My Task" });
  });

  it("handles call without params — omits params from body", async () => {
    let capturedBody: Record<string, unknown> = {};
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, (opts) => {
        capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return JSON.stringify(rpcOk(1, "1.2.3"));
      }, { headers: { "Content-Type": "application/json" } });

    await makeClient().call("getVersion");

    expect("params" in capturedBody).toBe(false);
    expect(capturedBody["method"]).toBe("getVersion");
  });

  it("sequential calls use incrementing ids", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      pool
        .intercept({ path: "/jsonrpc.php", method: "POST" })
        .reply(200, (opts) => {
          const body = JSON.parse(opts.body as string) as Record<string, unknown>;
          ids.push(body["id"] as number);
          return JSON.stringify(rpcOk(body["id"] as number, i));
        }, { headers: { "Content-Type": "application/json" } });
    }

    const client = makeClient();
    await client.call("getVersion");
    await client.call("getVersion");
    await client.call("getVersion");

    expect(ids[0]).toBe(1);
    expect(ids[1]).toBe(2);
    expect(ids[2]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Result passthrough — null and false
// ---------------------------------------------------------------------------

describe("Result passthrough", () => {
  it("returns null as-is (getters: entity not found — kanboard.ts handles this)", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify(rpcOk(1, null)), { headers: { "Content-Type": "application/json" } });

    const result = await makeClient().call("getTask", { task_id: 999 });
    expect(result).toBeNull();
  });

  it("returns false as-is (mutation failed — kanboard.ts handles this)", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify(rpcOk(1, false)), { headers: { "Content-Type": "application/json" } });

    const result = await makeClient().call("createTask", { title: "x", project_id: 1 });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Single call — HTTP error cases
// ---------------------------------------------------------------------------

describe("Single call — HTTP 401/403 → AuthError, no retry", () => {
  it("HTTP 401 → throws AuthError", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(401, "Unauthorized");

    await expect(makeClient().call("getVersion")).rejects.toBeInstanceOf(AuthError);
  });

  it("HTTP 403 → throws AuthError", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(403, "Forbidden");

    await expect(makeClient().call("getVersion")).rejects.toBeInstanceOf(AuthError);
  });

  it("HTTP 401 is NOT retried even for idempotent method", async () => {
    let callCount = 0;
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(401, () => { callCount++; return "Unauthorized"; })
      .times(1); // only once — if retried, the test mock would fail on 2nd call

    await expect(makeClient().call("getVersion")).rejects.toBeInstanceOf(AuthError);
    expect(callCount).toBe(1);
  });
});

describe("Single call — HTTP 404 → KanboardApiError", () => {
  it("HTTP 404 → KanboardApiError with code 404", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(404, "Not Found");

    const err = await makeClient().call("getVersion").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).code).toBe(404);
    expect((err as KanboardApiError).message).toMatch(/not found/i);
  });
});

describe("Single call — JSON-RPC error in 200 body", () => {
  it("JSON-RPC error envelope → throws KanboardApiError with code and message", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify(rpcErr(1, -32602, "Invalid params: title required")), { headers: { "Content-Type": "application/json" } });

    const err = await makeClient().call("createTask", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).code).toBe(-32602);
    expect((err as KanboardApiError).message).toBe("Invalid params: title required");
  });

  it("JSON-RPC error is NOT retried even for idempotent method", async () => {
    let callCount = 0;
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, () => {
        callCount++;
        return JSON.stringify(rpcErr(1, -32601, "Method not found"));
      }, { headers: { "Content-Type": "application/json" } })
      .times(1);

    await expect(makeClient().call("getVersion")).rejects.toBeInstanceOf(KanboardApiError);
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Retry behavior
// ---------------------------------------------------------------------------

describe("Retry — idempotent methods (get*)", () => {
  it("getVersion retries on HTTP 503 and succeeds on third attempt", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(503, () => { callCount++; return "Service Unavailable"; })
      .times(2);
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, () => { callCount++; return JSON.stringify(rpcOk(3, "1.2.3")); }, { headers: { "Content-Type": "application/json" } });

    const client = makeClient();
    const promise = client.call("getVersion");

    // Advance timers to cover both backoff delays (300ms + 900ms)
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(900);

    const result = await promise;
    expect(result).toBe("1.2.3");
    expect(callCount).toBe(3);
  });

  it("getVersion retries on HTTP 502", async () => {
    vi.useFakeTimers();
    let callCount = 0;

    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(502, () => { callCount++; return "Bad Gateway"; })
      .times(2);
    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, () => { callCount++; return JSON.stringify(rpcOk(3, "1.0.0")); }, { headers: { "Content-Type": "application/json" } });

    const promise = makeClient().call("getVersion");
    await vi.advanceTimersByTimeAsync(1500);
    await promise;
    expect(callCount).toBe(3);
  });

  it("getVersion exhausts retries on persistent HTTP 503 → throws KanboardApiError", async () => {
    vi.useFakeTimers();

    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(503, "Service Unavailable")
      .times(3); // 1 initial + 2 retries

    const promise = makeClient().call("getVersion").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1500);

    const err = await promise;
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).code).toBe(503);
  });

  it("searchTasks retries on HTTP 504", async () => {
    vi.useFakeTimers();
    let callCount = 0;

    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(504, () => { callCount++; return "Gateway Timeout"; })
      .times(1);
    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, () => { callCount++; return JSON.stringify(rpcOk(2, [])); }, { headers: { "Content-Type": "application/json" } });

    const promise = makeClient().call("searchTasks", { project_id: 1, query: "open" });
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(callCount).toBe(2);
  });
});

describe("Retry — mutations NEVER retry", () => {
  it("createTask getting HTTP 503 does NOT retry — immediate KanboardApiError", async () => {
    let callCount = 0;
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(503, () => { callCount++; return "Service Unavailable"; })
      .times(1);

    const err = await makeClient().call("createTask", { title: "x", project_id: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect(callCount).toBe(1);
  });

  it("updateTask getting HTTP 502 does NOT retry", async () => {
    let callCount = 0;
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(502, () => { callCount++; return "Bad Gateway"; })
      .times(1);

    await expect(makeClient().call("updateTask", { id: 1 })).rejects.toBeInstanceOf(KanboardApiError);
    expect(callCount).toBe(1);
  });
});

describe("Retry — 429 with Retry-After header", () => {
  it("idempotent method retries on 429 and eventually succeeds", async () => {
    vi.useFakeTimers();
    let callCount = 0;

    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(429, () => { callCount++; return "Too Many Requests"; }, { headers: { "Retry-After": "1" } })
      .times(1);
    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, () => { callCount++; return JSON.stringify(rpcOk(2, "ok")); }, { headers: { "Content-Type": "application/json" } });

    const promise = makeClient().call("getVersion");
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result).toBe("ok");
    expect(callCount).toBe(2);
  });

  it("exhausted retries on persistent 429 → KanboardApiError code 429 with retryAfter", async () => {
    vi.useFakeTimers();

    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(429, "Too Many Requests", { headers: { "Retry-After": "5" } })
      .times(3);

    const promise = makeClient().call("getVersion").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2000);

    const err = await promise;
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).code).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 6. Timeout
// ---------------------------------------------------------------------------

describe("Timeout", () => {
  it("AbortSignal.timeout fires → TimeoutError", async () => {
    // Intercept and delay response longer than timeout
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, () => {
        // This will never be reached within the tiny timeout
        return JSON.stringify(rpcOk(1, "ok"));
      }, { headers: { "Content-Type": "application/json" } })
      .delay(500); // delay > timeoutMs

    const client = new ApiClient({
      config: makeConfig({ timeoutMs: 10 }), // 10ms timeout
      logger: createLogger({ level: "silent" }),
    });

    await expect(client.call("getVersion")).rejects.toBeInstanceOf(TimeoutError);
  });
});

// ---------------------------------------------------------------------------
// 7. Idempotency / network error retry
// ---------------------------------------------------------------------------

describe("Network error retry", () => {
  it("idempotent method retries on network error (ECONNREFUSED-like)", async () => {
    vi.useFakeTimers();
    let callCount = 0;

    // First call: simulate network error
    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .replyWithError(new Error("ECONNREFUSED"))
      .times(1);

    // Second call (retry): success
    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, () => { callCount++; return JSON.stringify(rpcOk(2, "1.0.0")); }, { headers: { "Content-Type": "application/json" } });

    const promise = makeClient().call("getVersion");
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result).toBe("1.0.0");
    expect(callCount).toBe(1);
  });

  it("mutation does NOT retry on network error", async () => {
    let callCount = 0;
    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .replyWithError(new Error("ECONNREFUSED"));

    const err = await makeClient().call("createTask", { title: "x", project_id: 1 }).catch((e: unknown) => {
      callCount++;
      return e;
    });
    expect(callCount).toBe(1);
    expect(err).toBeInstanceOf(KanboardApiError);
  });
});

// ---------------------------------------------------------------------------
// 8. Invalid response shapes
// ---------------------------------------------------------------------------

describe("Invalid response shapes", () => {
  it("malformed JSON → KanboardApiError INVALID_JSON_RPC", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, "not json at all", { headers: { "Content-Type": "text/html" } });

    const err = await makeClient().call("getVersion").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).message).toMatch(/non-JSON/i);
  });

  it("id mismatch → KanboardApiError", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify(rpcOk(999, "something")), { headers: { "Content-Type": "application/json" } });

    const err = await makeClient().call("getVersion").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).message).toMatch(/Mismatched request id/i);
  });

  it("array response to single call → KanboardApiError shape mismatch", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify([rpcOk(1, "a"), rpcOk(2, "b")]), { headers: { "Content-Type": "application/json" } });

    const err = await makeClient().call("getVersion").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).message).toMatch(/shape mismatch/i);
  });
});

// ---------------------------------------------------------------------------
// 9. Batch — happy path
// ---------------------------------------------------------------------------

describe("Batch — happy path", () => {
  it("sends array body with correct shape per item", async () => {
    let capturedBody: unknown[] = [];
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, (opts) => {
        capturedBody = JSON.parse(opts.body as string) as unknown[];
        return JSON.stringify([
          rpcOk(0, 101),
          rpcOk(1, 102),
          rpcOk(2, 103),
        ]);
      }, { headers: { "Content-Type": "application/json" } });

    const calls: BatchCall[] = [
      { method: "createTask", params: { title: "A", project_id: 1 }, id: 0 },
      { method: "createTask", params: { title: "B", project_id: 1 }, id: 1 },
      { method: "createTask", params: { title: "C", project_id: 1 }, id: 2 },
    ];
    await makeClient().batch(calls);

    expect(Array.isArray(capturedBody)).toBe(true);
    expect(capturedBody).toHaveLength(3);
    for (const item of capturedBody) {
      const env = item as Record<string, unknown>;
      expect(env["jsonrpc"]).toBe("2.0");
      expect(typeof env["id"]).toBe("number");
      expect(typeof env["method"]).toBe("string");
    }
    // Ids must be unique (matching input)
    const ids = (capturedBody as Record<string, unknown>[]).map((e) => e["id"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("aligns results to input order even when response is out of order", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify([
        rpcOk(2, 103),  // returned 3rd in response
        rpcOk(0, 101),  // returned 1st
        rpcOk(1, 102),  // returned 2nd
      ]), { headers: { "Content-Type": "application/json" } });

    const calls: BatchCall[] = [
      { method: "createTask", params: { title: "A", project_id: 1 }, id: 0 },
      { method: "createTask", params: { title: "B", project_id: 1 }, id: 1 },
      { method: "createTask", params: { title: "C", project_id: 1 }, id: 2 },
    ];
    const results = await makeClient().batch(calls);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ ok: true, index: 0, result: 101 });
    expect(results[1]).toMatchObject({ ok: true, index: 1, result: 102 });
    expect(results[2]).toMatchObject({ ok: true, index: 2, result: 103 });
  });

  it("batch empty calls returns empty array", async () => {
    const results = await makeClient().batch([]);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Batch — mixed success/error
// ---------------------------------------------------------------------------

describe("Batch — mixed results", () => {
  it("returns ok/error per item when some fail", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify([
        rpcOk(0, 101),
        rpcErr(1, -32602, "title required"),
        rpcOk(2, false),
      ]), { headers: { "Content-Type": "application/json" } });

    const calls: BatchCall[] = [
      { method: "createTask", params: { title: "A", project_id: 1 }, id: 0 },
      { method: "createTask", params: {}, id: 1 },
      { method: "createTask", params: { title: "C", project_id: 1 }, id: 2 },
    ];
    const results = await makeClient().batch(calls);

    expect(results[0]).toMatchObject({ ok: true, index: 0, result: 101 });
    expect(results[1]).toMatchObject({ ok: false, index: 1, error: { code: -32602, message: "title required" } });
    expect(results[2]).toMatchObject({ ok: true, index: 2, result: false });
  });
});

// ---------------------------------------------------------------------------
// 11. Batch — retry behavior
// ---------------------------------------------------------------------------

describe("Batch — retry on transient errors", () => {
  it("all-idempotent batch retries on HTTP 503", async () => {
    vi.useFakeTimers();
    let callCount = 0;

    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(503, () => { callCount++; return "Service Unavailable"; })
      .times(1);
    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, () => {
        callCount++;
        return JSON.stringify([rpcOk(0, { id: 1 }), rpcOk(1, { id: 2 })]);
      }, { headers: { "Content-Type": "application/json" } });

    const calls: BatchCall[] = [
      { method: "getTask", params: { task_id: 1 }, id: 0 },
      { method: "getTask", params: { task_id: 2 }, id: 1 },
    ];
    const promise = makeClient().batch(calls);
    await vi.advanceTimersByTimeAsync(500);
    const results = await promise;

    expect(results[0]).toMatchObject({ ok: true });
    expect(callCount).toBe(2);
  });

  it("batch with mutations does NOT retry on HTTP 503", async () => {
    let callCount = 0;
    pool.intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(503, () => { callCount++; return "Service Unavailable"; })
      .times(1);

    const calls: BatchCall[] = [
      { method: "createTask", params: { title: "A", project_id: 1 }, id: 0 },
      { method: "getTask", params: { task_id: 1 }, id: 1 },
    ];
    const err = await makeClient().batch(calls).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect(callCount).toBe(1);
  });
});

describe("Batch — invalid response shape", () => {
  it("server returns single envelope for batch → KanboardApiError shape mismatch", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, JSON.stringify(rpcOk(1, "something")), { headers: { "Content-Type": "application/json" } });

    const calls: BatchCall[] = [
      { method: "createTask", params: { title: "A", project_id: 1 }, id: 0 },
    ];
    const err = await makeClient().batch(calls).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).message).toMatch(/shape mismatch/i);
  });
});

// ---------------------------------------------------------------------------
// 12. Logging redaction sanity
// ---------------------------------------------------------------------------

describe("Logging redaction sanity", () => {
  it("does not leak token in logs when call fails with HTTP 401", async () => {
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(401, "Unauthorized");

    // Capture stderr
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown, ...args: unknown[]) => {
      if (typeof chunk === "string") stderrChunks.push(chunk);
      else if (Buffer.isBuffer(chunk)) stderrChunks.push(chunk.toString());
      // Call through to the real implementation to avoid breaking pino
      return originalWrite(chunk as Parameters<typeof process.stderr.write>[0], ...(args as Parameters<typeof process.stderr.write>).slice(1));
    });

    const client = new ApiClient({
      config: makeConfig({ mode: "personal", username: USERNAME }),
      logger: createLogger({ level: "debug" }),
    });

    try {
      await client.call("getVersion");
    } catch {
      // Expected AuthError
    }

    spy.mockRestore();

    const allOutput = stderrChunks.join("");
    // The raw token must never appear in logs
    expect(allOutput).not.toContain(TOKEN);
    // The auth header base64 must never appear
    const rawAuthB64 = Buffer.from(`${USERNAME}:${TOKEN}`).toString("base64");
    expect(allOutput).not.toContain(rawAuthB64);
  });
});

// ---------------------------------------------------------------------------
// 13. Body shape edge cases
// ---------------------------------------------------------------------------

describe("Body shape", () => {
  it("single call has required JSON-RPC 2.0 fields", async () => {
    let capturedBody: Record<string, unknown> = {};
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, (opts) => {
        capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
        return JSON.stringify(rpcOk(capturedBody["id"] as number, "ok"));
      }, { headers: { "Content-Type": "application/json" } });

    await makeClient().call("getVersion");

    expect(capturedBody["jsonrpc"]).toBe("2.0");
    expect(typeof capturedBody["id"]).toBe("number");
    expect(capturedBody["method"]).toBe("getVersion");
  });

  it("batch body is array; each item has unique id and correct shape", async () => {
    let capturedBodies: Record<string, unknown>[] = [];
    pool
      .intercept({ path: "/jsonrpc.php", method: "POST" })
      .reply(200, (opts) => {
        capturedBodies = JSON.parse(opts.body as string) as Record<string, unknown>[];
        return JSON.stringify(capturedBodies.map((b) => rpcOk(b["id"] as number, true)));
      }, { headers: { "Content-Type": "application/json" } });

    const calls: BatchCall[] = [
      { method: "createTask", params: { title: "X", project_id: 1 }, id: 0 },
      { method: "createTask", params: { title: "Y", project_id: 1 }, id: 1 },
    ];
    await makeClient().batch(calls);

    expect(capturedBodies).toHaveLength(2);
    const ids = capturedBodies.map((b) => b["id"]);
    expect(new Set(ids).size).toBe(2); // unique ids
    for (const item of capturedBodies) {
      expect(item["jsonrpc"]).toBe("2.0");
      expect(typeof item["method"]).toBe("string");
    }
  });
});
