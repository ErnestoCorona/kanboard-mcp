/**
 * Unit tests for src/transports/stdio.ts
 *
 * Strategy:
 * - Mock `./bootstrap.js` to return a controlled BootstrapResult (no real handler).
 * - Mock `StdioServerTransport` to avoid real stdin/stdout interaction.
 * - Verify: (1) bootstrap is called, (2) startup banner is logged, (3) server.connect
 *   is called with a StdioServerTransport instance, (4) runStdio() resolves cleanly.
 *
 * We do NOT test the MCP protocol round-trip (spawning dist/index.js + JSON-RPC
 * exchange). That belongs in the integration test suite (Batch F territory).
 * The goal here is to verify the wiring without real I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigError } from "../../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Mocks — must be at module top level so vi.mock hoisting works correctly
// ---------------------------------------------------------------------------

// Mock bootstrap to avoid real env loading, real handler construction,
// and real getMe() background calls.
vi.mock("../../../src/transports/bootstrap.js", () => ({
  bootstrap: vi.fn(),
}));

// Mock StdioServerTransport to avoid real stdin/stdout.
// We use a class mock so `new StdioServerTransport()` works correctly.
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  const MockStdioServerTransport = vi.fn(function (this: MockTransport) {
    this.close = vi.fn().mockResolvedValue(undefined);
    this.onclose = undefined;
    this.start = vi.fn().mockResolvedValue(undefined);
  });
  return { StdioServerTransport: MockStdioServerTransport };
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MockTransport {
  close: ReturnType<typeof vi.fn>;
  onclose: (() => void) | undefined;
  start: ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Import module under test AFTER mock declarations
// ---------------------------------------------------------------------------

const { runStdio } = await import("../../../src/transports/stdio.js");
const { bootstrap: mockBootstrapFn } = await import("../../../src/transports/bootstrap.js");
const { StdioServerTransport: MockStdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

const mockBootstrap = vi.mocked(mockBootstrapFn);
const MockTransportCtor = vi.mocked(MockStdioServerTransport as unknown as new () => MockTransport);

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
};

const mockServer = {
  connect: vi.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PERSONAL_ENV: NodeJS.ProcessEnv = {
  KANBOARD_URL: "https://pm.test.example.com",
  KANBOARD_API_TOKEN: "AAAA1111BBBB2222CCCC3333",
  KANBOARD_USERNAME: "alice",
  KANBOARD_AUTH_MODE: "personal",
  LOG_LEVEL: "silent",
};

/**
 * Configure the mocked bootstrap to return a valid BootstrapResult, and
 * set up server.connect to fire onclose immediately so runStdio() resolves.
 */
function setupDefaultMocks(): void {
  mockBootstrap.mockReturnValue({
    server: mockServer as never,
    logger: mockLogger as never,
    parsedEnv: {
      url: "https://pm.test.example.com",
      apiToken: "AAAA1111BBBB2222CCCC3333",
      mode: "personal",
      username: "alice",
      timeoutMs: 15000,
      logLevel: "silent",
    } as never,
    bundle: {
      apiClient: {},
      handler: {},
      resolvers: {},
    } as never,
    configError: null,
  });

  // server.connect fires the transport's onclose immediately so the process
  // lifecycle resolves in tests (simulates stdin EOF).
  mockServer.connect.mockImplementation(async (transport: MockTransport) => {
    await Promise.resolve();
    transport.onclose?.();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// runStdio — basic wiring
// ---------------------------------------------------------------------------

describe("runStdio — basic wiring", () => {
  it("calls bootstrap with the provided env object", async () => {
    await runStdio(PERSONAL_ENV);

    expect(mockBootstrap).toHaveBeenCalledOnce();
    expect(mockBootstrap).toHaveBeenCalledWith(PERSONAL_ENV);
  });

  it("returns a Promise", () => {
    const result = runStdio(PERSONAL_ENV);

    expect(result).toBeInstanceOf(Promise);

    return result;
  });

  it("resolves after the transport closes", async () => {
    await expect(runStdio(PERSONAL_ENV)).resolves.toBeUndefined();
  });

  it("constructs a StdioServerTransport and passes it to server.connect", async () => {
    await runStdio(PERSONAL_ENV);

    // StdioServerTransport constructor was called once.
    expect(MockTransportCtor).toHaveBeenCalledOnce();

    // server.connect was called once with the transport instance.
    expect(mockServer.connect).toHaveBeenCalledOnce();

    // The instance passed to connect should be the one created by the ctor.
    const transportInstance = MockTransportCtor.mock.instances[0];
    expect(mockServer.connect).toHaveBeenCalledWith(transportInstance);
  });
});

// ---------------------------------------------------------------------------
// runStdio — startup banner logged
// ---------------------------------------------------------------------------

describe("runStdio — startup banner", () => {
  it("logs at least one info message (startup banner)", async () => {
    await runStdio(PERSONAL_ENV);

    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("startup banner message includes 'starting stdio transport'", async () => {
    await runStdio(PERSONAL_ENV);

    const allCalls = mockLogger.info.mock.calls;
    const bannerCall = allCalls.find(
      (call) => typeof call[1] === "string" && call[1].includes("starting stdio transport"),
    );
    expect(bannerCall, "startup banner log call not found").toBeDefined();
  });

  it("startup banner context includes version, node, target, and mode", async () => {
    await runStdio(PERSONAL_ENV);

    const allCalls = mockLogger.info.mock.calls;
    // Find the call that has a context object with a 'mode' field.
    const bannerCall = allCalls.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        "mode" in (call[0] as Record<string, unknown>),
    );

    expect(bannerCall, "banner call with mode field not found").toBeDefined();
    if (!bannerCall) return;

    const ctx = bannerCall[0] as Record<string, unknown>;
    expect(ctx["name"]).toBe("kanboard-mcp");
    expect(typeof ctx["version"]).toBe("string");
    expect(typeof ctx["node"]).toBe("string");
    expect(ctx["target"]).toBe("pm.test.example.com");
    expect(ctx["mode"]).toBe("personal");
  });
});

// ---------------------------------------------------------------------------
// runStdio — error propagation
// ---------------------------------------------------------------------------

describe("runStdio — error propagation", () => {
  it("rejects with whatever bootstrap throws (genuinely unexpected errors)", async () => {
    // Lazy credential validation: bootstrap() no longer throws ConfigError for
    // missing creds (it degrades). But ANY error it DOES throw — e.g. a
    // genuinely unexpected one — must still propagate through runStdio.
    const unexpected = new ConfigError("simulated unexpected boot failure");
    mockBootstrap.mockImplementation(() => {
      throw unexpected;
    });

    await expect(runStdio(PERSONAL_ENV)).rejects.toBe(unexpected);
  });

  it("rejects with the original error when server.connect rejects", async () => {
    const connectError = new Error("Transport failed to start");
    mockServer.connect.mockRejectedValue(connectError);

    await expect(runStdio(PERSONAL_ENV)).rejects.toBe(connectError);
  });
});

// ---------------------------------------------------------------------------
// runStdio — degraded mode (bootstrap returns parsedEnv: null)
// ---------------------------------------------------------------------------

describe("runStdio — degraded mode banner", () => {
  function setupDegradedMocks(): void {
    mockBootstrap.mockReturnValue({
      server: mockServer as never,
      logger: mockLogger as never,
      parsedEnv: null,
      bundle: {
        apiClient: {},
        handler: {},
        resolvers: {},
      } as never,
      configError: new ConfigError("KANBOARD_URL is required but was not set."),
    });

    mockServer.connect.mockImplementation(async (transport: MockTransport) => {
      await Promise.resolve();
      transport.onclose?.();
    });
  }

  it("does NOT crash when parsedEnv is null — resolves cleanly", async () => {
    setupDegradedMocks();

    await expect(runStdio(PERSONAL_ENV)).resolves.toBeUndefined();
  });

  it("emits a degraded-mode warning banner (no parsedEnv.url dereference)", async () => {
    setupDegradedMocks();

    await runStdio(PERSONAL_ENV);

    const warnCall = mockLogger.warn.mock.calls.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>)["degraded"] === true,
    );
    expect(warnCall, "degraded banner warn call not found").toBeDefined();
    if (!warnCall) return;
    expect(typeof warnCall[1]).toBe("string");
    expect(String(warnCall[1])).toContain("DEGRADED");
  });

  it("still connects the transport in degraded mode", async () => {
    setupDegradedMocks();

    await runStdio(PERSONAL_ENV);

    expect(mockServer.connect).toHaveBeenCalledOnce();
  });
});
