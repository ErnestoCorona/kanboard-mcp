/**
 * Unit tests for src/transports/bootstrap.ts
 *
 * Strategy:
 * - Call `bootstrap()` with a minimal valid env object (no real network).
 * - Assert the returned BootstrapResult shape.
 * - Assert registerTools is called (tools are mounted on the server) — verified
 *   by spying on the registerTools export from src/tools/index.ts.
 * - Assert ConfigError propagates from loadEnv() on missing env vars.
 * - Assert bootstrap() is synchronous (returns before getMe resolves).
 *
 * We do NOT make any real HTTP connections. getMe() fires in the background
 * inside createHandler() and fails silently (eager-but-non-fatal). We
 * suppress the unhandled rejection in each test case.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { bootstrap, type BootstrapResult } from "../../../src/transports/bootstrap.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigError } from "../../../src/shared/errors.js";
import * as toolsIndex from "../../../src/tools/index.js";

// ---------------------------------------------------------------------------
// Shared env fixtures
// ---------------------------------------------------------------------------

const PERSONAL_ENV: NodeJS.ProcessEnv = {
  KANBOARD_URL: "https://pm.test.example.com",
  KANBOARD_API_TOKEN: "AAAA1111BBBB2222CCCC3333",
  KANBOARD_USERNAME: "alice",
  KANBOARD_AUTH_MODE: "personal",
  LOG_LEVEL: "error",
};

const APP_ENV: NodeJS.ProcessEnv = {
  KANBOARD_URL: "https://pm.test.example.com",
  KANBOARD_API_TOKEN: "AAAA1111BBBB2222CCCC3333",
  KANBOARD_AUTH_MODE: "app",
  LOG_LEVEL: "error",
};

// ---------------------------------------------------------------------------
// Helper: suppress the background getMe() rejection that fires in unit tests
// (no real HTTP server available, so getMe always rejects)
// ---------------------------------------------------------------------------

function suppressGetMe(result: BootstrapResult): void {
  void result.bundle.handler
    .getMe()
    .catch(() => {
      /* expected in unit tests — no live Kanboard server */
    });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// BootstrapResult — structural assertions (personal mode)
// ---------------------------------------------------------------------------

describe("bootstrap — personal mode", () => {
  it("returns a non-null BootstrapResult", () => {
    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);

    expect(result).toBeDefined();
    expect(result.server).toBeDefined();
    expect(result.bundle).toBeDefined();
    expect(result.logger).toBeDefined();
    expect(result.parsedEnv).toBeDefined();
  });

  it("server is an McpServer instance", () => {
    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);

    expect(result.server).toBeInstanceOf(McpServer);
  });

  it("bundle has apiClient, handler, and resolvers", () => {
    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);

    expect(result.bundle.apiClient).toBeDefined();
    expect(result.bundle.handler).toBeDefined();
    expect(result.bundle.resolvers).toBeDefined();
  });

  it("parsedEnv reflects the personal mode env vars", () => {
    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);

    expect(result.parsedEnv.mode).toBe("personal");
    expect(result.parsedEnv.url).toBe("https://pm.test.example.com");
    expect(result.parsedEnv.username).toBe("alice");
  });

  it("logger is defined and has info/error/warn methods", () => {
    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);

    expect(typeof result.logger.info).toBe("function");
    expect(typeof result.logger.error).toBe("function");
    expect(typeof result.logger.warn).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// BootstrapResult — structural assertions (app mode)
// ---------------------------------------------------------------------------

describe("bootstrap — app mode", () => {
  it("returns a valid BootstrapResult in app mode", () => {
    const result = bootstrap(APP_ENV);
    suppressGetMe(result);

    expect(result.server).toBeInstanceOf(McpServer);
    expect(result.bundle.handler).toBeDefined();
    expect(result.parsedEnv.mode).toBe("app");
  });

  it("parsedEnv.username is 'jsonrpc' in app mode", () => {
    const result = bootstrap(APP_ENV);
    suppressGetMe(result);

    expect(result.parsedEnv.username).toBe("jsonrpc");
  });
});

// ---------------------------------------------------------------------------
// registerTools called — tools mounted on the server
// ---------------------------------------------------------------------------

describe("bootstrap — registerTools is called", () => {
  it("registerTools is called once with the server and deps", () => {
    // Spy on registerTools from the tools/index module.
    // We let it run (no mockImplementation) so the real tools are registered.
    const spy = vi.spyOn(toolsIndex, "registerTools");

    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);

    expect(spy).toHaveBeenCalledOnce();
    // First arg should be the McpServer, second should be deps with handler + resolvers.
    const [serverArg, depsArg] = spy.mock.calls[0] ?? [];
    expect(serverArg).toBeInstanceOf(McpServer);
    expect(depsArg).toBeDefined();
    expect(depsArg?.handler).toBeDefined();
    expect(depsArg?.resolvers).toBeDefined();
  });

  it("36 tools are registered on the server after bootstrap", () => {
    // Verify indirectly: by spying on server.registerTool BEFORE it's called.
    // We spy on McpServer.prototype.registerTool so ANY instance will record calls.
    const registerToolSpy = vi.spyOn(McpServer.prototype, "registerTool");

    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);

    expect(registerToolSpy).toHaveBeenCalledTimes(36);
    // The server returned IS the McpServer that received the calls.
    expect(result.server).toBeInstanceOf(McpServer);
  });
});

// ---------------------------------------------------------------------------
// ConfigError propagation
// ---------------------------------------------------------------------------

describe("bootstrap — ConfigError propagation", () => {
  it("missing KANBOARD_URL → throws ConfigError", () => {
    const env: NodeJS.ProcessEnv = {
      ...PERSONAL_ENV,
      KANBOARD_URL: undefined,
    };

    expect(() => bootstrap(env)).toThrow(ConfigError);
  });

  it("missing KANBOARD_API_TOKEN → throws ConfigError", () => {
    const env: NodeJS.ProcessEnv = {
      ...PERSONAL_ENV,
      KANBOARD_API_TOKEN: undefined,
    };

    expect(() => bootstrap(env)).toThrow(ConfigError);
  });

  it("personal mode + missing KANBOARD_USERNAME → throws ConfigError", () => {
    const env: NodeJS.ProcessEnv = {
      ...PERSONAL_ENV,
      KANBOARD_USERNAME: undefined,
    };

    expect(() => bootstrap(env)).toThrow(ConfigError);
  });

  it("invalid KANBOARD_AUTH_MODE → throws ConfigError", () => {
    const env: NodeJS.ProcessEnv = {
      ...PERSONAL_ENV,
      KANBOARD_AUTH_MODE: "invalid-mode",
    };

    expect(() => bootstrap(env)).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// bootstrap() is synchronous
// ---------------------------------------------------------------------------

describe("bootstrap — synchronous return contract", () => {
  it("returns synchronously (not a Promise)", () => {
    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);

    // If bootstrap returned a Promise, `result.server` would be undefined
    // on the Promise object — this assertion proves it's the real BootstrapResult.
    expect(result.server).toBeInstanceOf(McpServer);

    // Additional proof: result must not be a thenable.
    expect(result).not.toHaveProperty("then");
  });

  it("completes in well under 100ms (no network round-trip)", () => {
    const start = Date.now();
    const result = bootstrap(PERSONAL_ENV);
    suppressGetMe(result);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});
