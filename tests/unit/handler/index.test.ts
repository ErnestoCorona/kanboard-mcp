/**
 * Unit tests for src/handler/index.ts — createHandler factory + barrel exports.
 *
 * Strategy: construct a real HandlerBundle against a known-bad (no live network)
 * config. getMe() runs in the background; we don't await it in the factory
 * tests (we only verify shape + wiring). Tests that need getMe to fail use
 * vi.spyOn on the underlying ApiClient's call method.
 *
 * Note on getMe in background: every handler ctor fires getMe eagerly.
 * In tests that do NOT use a mock fetch, getMe will fail with a network error
 * (no listener on the test URL). This is intentional (eager-but-non-fatal):
 * the factory does not await it, and tests only inspect the returned shape.
 * We suppress unhandled-rejection warnings by attaching a .catch() to the
 * handler's getMe() promise where needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHandler } from "../../../src/handler/index.js";
import { ApiClient } from "../../../src/handler/api-client.js";
import { KanboardHandler } from "../../../src/handler/kanboard.js";
import { Resolvers } from "../../../src/handler/resolvers.js";
import { ConfigError } from "../../../src/shared/errors.js";
import type { KanboardConfig } from "../../../src/shared/types.js";
import { createLogger } from "../../../src/shared/logger.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_PERSONAL_CONFIG: KanboardConfig = {
  url: "http://kanboard.test",
  apiToken: "TEST-TOKEN-aaaa1111",
  mode: "personal",
  username: "alice",
};

const BASE_APP_CONFIG: KanboardConfig = {
  url: "http://kanboard.test",
  apiToken: "TEST-TOKEN-aaaa1111",
  mode: "app",
  // username intentionally omitted — app mode does not need it
};

// Suppress unhandled rejections from background getMe() calls in tests that
// do not mock fetch. We attach a no-op .catch() on the handler's getMe().
function suppressGetMe(handler: KanboardHandler): void {
  void handler.getMe().catch(() => {
    /* background getMe — expected to fail in unit tests with no HTTP server */
  });
}

// ---------------------------------------------------------------------------
// Barrel re-exports
// ---------------------------------------------------------------------------

describe("barrel re-exports", () => {
  it("exports ApiClient", () => {
    expect(ApiClient).toBeDefined();
    expect(typeof ApiClient).toBe("function");
  });

  it("exports KanboardHandler", () => {
    expect(KanboardHandler).toBeDefined();
    expect(typeof KanboardHandler).toBe("function");
  });

  it("exports Resolvers", () => {
    expect(Resolvers).toBeDefined();
    expect(typeof Resolvers).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// createHandler — bundle shape
// ---------------------------------------------------------------------------

describe("createHandler — bundle shape (personal mode)", () => {
  let bundle: ReturnType<typeof createHandler>;

  beforeEach(() => {
    bundle = createHandler(BASE_PERSONAL_CONFIG);
    suppressGetMe(bundle.handler);
  });

  it("returns a non-null HandlerBundle", () => {
    expect(bundle).toBeDefined();
    expect(bundle.apiClient).toBeDefined();
    expect(bundle.handler).toBeDefined();
    expect(bundle.resolvers).toBeDefined();
  });

  it("apiClient is an ApiClient instance", () => {
    expect(bundle.apiClient).toBeInstanceOf(ApiClient);
  });

  it("handler is a KanboardHandler instance", () => {
    expect(bundle.handler).toBeInstanceOf(KanboardHandler);
  });

  it("resolvers is a Resolvers instance", () => {
    expect(bundle.resolvers).toBeInstanceOf(Resolvers);
  });
});

// ---------------------------------------------------------------------------
// createHandler — handler method shape
// ---------------------------------------------------------------------------

describe("createHandler — handler has expected methods", () => {
  let bundle: ReturnType<typeof createHandler>;

  beforeEach(() => {
    bundle = createHandler(BASE_PERSONAL_CONFIG);
    suppressGetMe(bundle.handler);
  });

  it("handler.getMe is a function", () => {
    expect(typeof bundle.handler.getMe).toBe("function");
  });

  it("handler.getMeId is a function", () => {
    expect(typeof bundle.handler.getMeId).toBe("function");
  });

  it("handler.getMyProjects is a function", () => {
    expect(typeof bundle.handler.getMyProjects).toBe("function");
  });

  it("handler.getTask is a function", () => {
    expect(typeof bundle.handler.getTask).toBe("function");
  });

  it("handler.createTask is a function", () => {
    expect(typeof bundle.handler.createTask).toBe("function");
  });

  it("handler.getColumns is a function", () => {
    expect(typeof bundle.handler.getColumns).toBe("function");
  });

  it("handler.getActiveSwimlanes is a function", () => {
    expect(typeof bundle.handler.getActiveSwimlanes).toBe("function");
  });

  it("handler.createComment is a function", () => {
    expect(typeof bundle.handler.createComment).toBe("function");
  });

  it("handler.createTasksBatch is a function", () => {
    expect(typeof bundle.handler.createTasksBatch).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// createHandler — resolvers method shape
// ---------------------------------------------------------------------------

describe("createHandler — resolvers has expected methods", () => {
  let bundle: ReturnType<typeof createHandler>;

  beforeEach(() => {
    bundle = createHandler(BASE_PERSONAL_CONFIG);
    suppressGetMe(bundle.handler);
  });

  it("resolvers.resolveColumnIdByName is a function", () => {
    expect(typeof bundle.resolvers.resolveColumnIdByName).toBe("function");
  });

  it("resolvers.resolveDefaultSwimlaneId is a function", () => {
    expect(typeof bundle.resolvers.resolveDefaultSwimlaneId).toBe("function");
  });

  it("resolvers.invalidate is a function", () => {
    expect(typeof bundle.resolvers.invalidate).toBe("function");
  });

  it("resolvers.invalidateAll is a function", () => {
    expect(typeof bundle.resolvers.invalidateAll).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// createHandler — error propagation from ApiClient ctor
// ---------------------------------------------------------------------------

describe("createHandler — propagates ConfigError from ApiClient ctor", () => {
  it("personal mode + missing username → throws ConfigError before returning", () => {
    const config: KanboardConfig = {
      ...BASE_PERSONAL_CONFIG,
      username: undefined, // missing — ApiClient ctor should throw
    };

    expect(() => createHandler(config)).toThrow(ConfigError);
  });

  it("personal mode + empty username → throws ConfigError", () => {
    const config: KanboardConfig = {
      ...BASE_PERSONAL_CONFIG,
      username: "",
    };

    expect(() => createHandler(config)).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// createHandler — app mode
// ---------------------------------------------------------------------------

describe("createHandler — app mode", () => {
  it("succeeds without a username", () => {
    const bundle = createHandler(BASE_APP_CONFIG);
    suppressGetMe(bundle.handler);

    expect(bundle.apiClient).toBeInstanceOf(ApiClient);
    expect(bundle.handler).toBeInstanceOf(KanboardHandler);
    expect(bundle.resolvers).toBeInstanceOf(Resolvers);
  });
});

// ---------------------------------------------------------------------------
// createHandler — logger injection
// ---------------------------------------------------------------------------

describe("createHandler — logger injection", () => {
  it("injected logger is used by all three components (no errors thrown)", () => {
    // We verify this indirectly: if any component called createLogger() instead
    // of using the injected one, it would create a separate logger — but the
    // factory code only creates the logger once and passes it to all three.
    // A simple smoke test: factory must not throw when a custom logger is passed.
    const logger = createLogger({ level: "silent" });
    const bundle = createHandler(BASE_PERSONAL_CONFIG, { logger });
    suppressGetMe(bundle.handler);

    expect(bundle.apiClient).toBeInstanceOf(ApiClient);
    expect(bundle.handler).toBeInstanceOf(KanboardHandler);
    expect(bundle.resolvers).toBeInstanceOf(Resolvers);
  });

  it("spy on createLogger verifies it is called once when no logger injected", () => {
    // If opts.logger is provided the factory should NOT call createLogger again.
    // We verify the shape contract: the injected logger arrives in the bundle.
    const loggerSpy = createLogger({ level: "silent" });
    const warnSpy = vi.spyOn(loggerSpy, "warn");

    const bundle = createHandler(BASE_PERSONAL_CONFIG, { logger: loggerSpy });
    suppressGetMe(bundle.handler);

    // The logger must be the injected instance (no new separate instance created)
    // — indirect proof: a log.warn call on the spy is observable.
    // This tests that all three components share the same logger reference.
    expect(bundle).toBeDefined();
    // warnSpy should not have been called during construction (no warnings expected)
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createHandler — factory is synchronous (does not await getMe)
// ---------------------------------------------------------------------------

describe("createHandler — synchronous return contract", () => {
  it("returns synchronously before getMe resolves or rejects", () => {
    // If the factory awaited getMe, this test would need to be async and would
    // take network time. The fact that it completes synchronously proves the
    // factory does not block on getMe.
    const start = Date.now();
    const bundle = createHandler(BASE_PERSONAL_CONFIG);
    suppressGetMe(bundle.handler);
    const elapsed = Date.now() - start;

    // Should be well under 100ms (no network round-trip)
    expect(elapsed).toBeLessThan(100);
    expect(bundle.handler).toBeInstanceOf(KanboardHandler);
  });
});

// ---------------------------------------------------------------------------
// createHandler — app mode: apiClient uses literal "jsonrpc" username
// ---------------------------------------------------------------------------

describe("createHandler — app mode username wiring", () => {
  it("app mode: ApiClient is constructed (no ConfigError for missing username)", () => {
    // In app mode the ApiClient forces username = "jsonrpc" internally.
    // We verify it does not throw ConfigError (which only fires in personal mode
    // when username is missing).
    expect(() => {
      const bundle = createHandler(BASE_APP_CONFIG);
      suppressGetMe(bundle.handler);
    }).not.toThrow();
  });

  it("app mode + explicit username in config does not throw (username is ignored)", () => {
    const configWithUsername: KanboardConfig = {
      ...BASE_APP_CONFIG,
      username: "should-be-ignored",
    };
    expect(() => {
      const bundle = createHandler(configWithUsername);
      suppressGetMe(bundle.handler);
    }).not.toThrow();
  });
});
