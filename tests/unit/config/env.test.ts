/**
 * Unit tests for src/config/env.ts
 *
 * Tests cover:
 * - Personal mode happy path
 * - App mode happy path (username forced to "jsonrpc")
 * - App mode with KANBOARD_USERNAME present — warn but proceed, result has "jsonrpc"
 * - Missing KANBOARD_URL → ConfigError
 * - Invalid KANBOARD_URL (bad protocol) → ConfigError
 * - Trailing slash on URL is normalized (stripped)
 * - Personal mode + missing KANBOARD_USERNAME → ConfigError mentioning "personal mode"
 * - Invalid KANBOARD_AUTH_MODE → ConfigError listing valid modes
 * - Invalid KANBOARD_TIMEOUT_MS (negative, non-numeric) → ConfigError
 * - Token too short → ConfigError (by var name only — value never in message)
 * - Token value NEVER appears in error text
 * - Invalid LOG_LEVEL → ConfigError
 */

import { describe, it, expect } from "vitest";
import { loadEnv } from "../../../src/config/env.js";
import { ConfigError } from "../../../src/shared/errors.js";
import { JSONRPC_USERNAME_APP_MODE, DEFAULT_TIMEOUT_MS } from "../../../src/shared/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimum valid env vars for personal mode (all required fields). */
function personalEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    KANBOARD_URL: "https://pm.example.com",
    KANBOARD_AUTH_MODE: "personal",
    KANBOARD_USERNAME: "ernesto.corona",
    KANBOARD_API_TOKEN: "abcdefghij1234567890", // gitleaks:allow — mock token, 20 chars passes length check
    ...overrides,
  };
}

/** Minimum valid env vars for app mode. */
function appEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    KANBOARD_URL: "https://pm.example.com",
    KANBOARD_AUTH_MODE: "app",
    KANBOARD_API_TOKEN: "abcdefghij1234567890", // gitleaks:allow — mock token for app mode test
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Personal mode
// ---------------------------------------------------------------------------

describe("loadEnv — personal mode", () => {
  it("happy path: returns KanboardConfig with mode=personal and username populated", () => {
    const config = loadEnv(personalEnv());
    expect(config.mode).toBe("personal");
    expect(config.username).toBe("ernesto.corona");
    expect(config.url).toBe("https://pm.example.com");
    expect(config.apiToken).toBe("abcdefghij1234567890");
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.logLevel).toBe("info");
  });

  it("defaults mode to 'personal' when KANBOARD_AUTH_MODE is omitted", () => {
    const env = personalEnv();
    delete env["KANBOARD_AUTH_MODE"];
    const config = loadEnv(env);
    expect(config.mode).toBe("personal");
  });

  it("missing KANBOARD_USERNAME throws ConfigError mentioning 'personal mode'", () => {
    const env = personalEnv({ KANBOARD_USERNAME: undefined });
    expect(() => loadEnv(env)).toThrow(ConfigError);
    expect(() => loadEnv(env)).toThrow(/personal mode/i);
  });

  it("empty KANBOARD_USERNAME throws ConfigError mentioning 'personal mode'", () => {
    const env = personalEnv({ KANBOARD_USERNAME: "" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
    expect(() => loadEnv(env)).toThrow(/personal mode/i);
  });

  it("KANBOARD_USERNAME whitespace-only throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_USERNAME: "   " });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// App mode
// ---------------------------------------------------------------------------

describe("loadEnv — app mode", () => {
  it("happy path: username forced to JSONRPC_USERNAME_APP_MODE regardless of input", () => {
    const config = loadEnv(appEnv());
    expect(config.mode).toBe("app");
    expect(config.username).toBe(JSONRPC_USERNAME_APP_MODE);
    expect(config.username).toBe("jsonrpc");
  });

  it("KANBOARD_USERNAME present in app mode is ignored — result still has 'jsonrpc'", () => {
    const config = loadEnv(appEnv({ KANBOARD_USERNAME: "some-other-user" }));
    expect(config.username).toBe("jsonrpc");
  });

  it("app mode does not require KANBOARD_USERNAME", () => {
    const env = appEnv();
    expect(() => loadEnv(env)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe("loadEnv — KANBOARD_URL", () => {
  it("missing KANBOARD_URL throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_URL: undefined });
    expect(() => loadEnv(env)).toThrow(ConfigError);
    expect(() => loadEnv(env)).toThrow(/KANBOARD_URL/);
  });

  it("empty KANBOARD_URL throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_URL: "" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });

  it("invalid URL (unparseable) throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_URL: "not-a-url" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });

  it("ftp:// URL throws ConfigError (wrong protocol)", () => {
    const env = personalEnv({ KANBOARD_URL: "ftp://pm.example.com" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
    expect(() => loadEnv(env)).toThrow(/protocol/i);
  });

  it("trailing slash is stripped from URL", () => {
    const env = personalEnv({ KANBOARD_URL: "https://pm.example.com/" });
    const config = loadEnv(env);
    expect(config.url).toBe("https://pm.example.com");
  });

  it("multiple trailing slashes are all stripped", () => {
    const env = personalEnv({ KANBOARD_URL: "https://pm.example.com///" });
    const config = loadEnv(env);
    expect(config.url).toBe("https://pm.example.com");
  });

  it("http:// URL is accepted", () => {
    const env = personalEnv({ KANBOARD_URL: "http://pm.local" });
    const config = loadEnv(env);
    expect(config.url).toBe("http://pm.local");
  });
});

// ---------------------------------------------------------------------------
// KANBOARD_AUTH_MODE validation
// ---------------------------------------------------------------------------

describe("loadEnv — KANBOARD_AUTH_MODE", () => {
  it("invalid mode throws ConfigError listing valid modes", () => {
    const env = personalEnv({ KANBOARD_AUTH_MODE: "super-mode" });
    expect(() => loadEnv(env)).toThrow(ConfigError);

    // The error should mention both valid values
    let message = "";
    try {
      loadEnv(env);
    } catch (err) {
      if (ConfigError.is(err)) {
        message = err.message;
      }
    }
    expect(message).toContain("personal");
    expect(message).toContain("app");
  });

  it("case-sensitive — 'Personal' (capital P) throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_AUTH_MODE: "Personal" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// KANBOARD_TIMEOUT_MS validation
// ---------------------------------------------------------------------------

describe("loadEnv — KANBOARD_TIMEOUT_MS", () => {
  it("valid positive integer string is parsed correctly", () => {
    const config = loadEnv(personalEnv({ KANBOARD_TIMEOUT_MS: "5000" }));
    expect(config.timeoutMs).toBe(5000);
  });

  it("absent KANBOARD_TIMEOUT_MS defaults to DEFAULT_TIMEOUT_MS", () => {
    const config = loadEnv(personalEnv({ KANBOARD_TIMEOUT_MS: undefined }));
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("negative value throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_TIMEOUT_MS: "-100" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });

  it("zero throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_TIMEOUT_MS: "0" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });

  it("non-numeric string throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_TIMEOUT_MS: "abc" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });

  it("float string throws ConfigError (must be integer)", () => {
    const env = personalEnv({ KANBOARD_TIMEOUT_MS: "1500.5" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// KANBOARD_API_TOKEN validation
// ---------------------------------------------------------------------------

describe("loadEnv — KANBOARD_API_TOKEN", () => {
  it("token too short throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_API_TOKEN: "tooshort" }); // 8 chars < 16
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });

  it("missing token throws ConfigError", () => {
    const env = personalEnv({ KANBOARD_API_TOKEN: undefined });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });

  it("token value NEVER appears in error message when token is too short", () => {
    const shortToken = "tooshort"; // 8 chars
    const env = personalEnv({ KANBOARD_API_TOKEN: shortToken });

    let errorMessage = "";
    try {
      loadEnv(env);
    } catch (err) {
      if (ConfigError.is(err)) {
        errorMessage = err.message;
      }
    }

    expect(errorMessage).not.toContain(shortToken);
    expect(errorMessage).toContain("KANBOARD_API_TOKEN");
  });

  it("token value NEVER appears in error message when url is missing", () => {
    // Inject a known token literal; assert it never leaks into ANY ConfigError message
    const knownToken = "supersecrettoken00001"; // 21 chars — passes length check
    const env = personalEnv({
      KANBOARD_API_TOKEN: knownToken,
      KANBOARD_URL: undefined, // force a ConfigError on URL
    });

    let errorMessage = "";
    try {
      loadEnv(env);
    } catch (err) {
      if (ConfigError.is(err)) {
        errorMessage = err.message;
      }
    }

    expect(errorMessage).not.toContain(knownToken);
  });

  it("token value NEVER appears in error message when username is missing (personal mode)", () => {
    const knownToken = "supersecrettoken00001";
    const env = personalEnv({
      KANBOARD_API_TOKEN: knownToken,
      KANBOARD_USERNAME: undefined,
    });

    let errorMessage = "";
    try {
      loadEnv(env);
    } catch (err) {
      if (ConfigError.is(err)) {
        errorMessage = err.message;
      }
    }

    expect(errorMessage).not.toContain(knownToken);
  });
});

// ---------------------------------------------------------------------------
// LOG_LEVEL validation
// ---------------------------------------------------------------------------

describe("loadEnv — LOG_LEVEL", () => {
  it("defaults to 'info' when absent", () => {
    const config = loadEnv(personalEnv({ LOG_LEVEL: undefined }));
    expect(config.logLevel).toBe("info");
  });

  it("accepts all valid pino levels", () => {
    const levels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
    for (const level of levels) {
      const config = loadEnv(personalEnv({ LOG_LEVEL: level }));
      expect(config.logLevel).toBe(level);
    }
  });

  it("invalid log level throws ConfigError", () => {
    const env = personalEnv({ LOG_LEVEL: "verbose" });
    expect(() => loadEnv(env)).toThrow(ConfigError);
  });
});
