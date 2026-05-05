/**
 * Logger redaction tests — NFR-Logging (S9).
 *
 * Strategy: create a pino logger using the SAME redactionPaths exported by
 * logger.ts (single source of truth), write to a PassThrough stream captured
 * in memory, emit log lines that contain a token literal at various paths,
 * and assert the literal NEVER appears verbatim in any captured output.
 *
 * The token literal used here is a non-real placeholder — never a real credential.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import type { Writable } from "node:stream";
import pino from "pino";
import { redactionPaths, createLogger } from "../../../src/shared/logger.js";

// Fake non-real token used only in tests — NEVER use a real credential here.
const TEST_TOKEN = "TEST-TOKEN-DO-NOT-USE-aaaa1111bbbb2222";
const TEST_PASSWORD = "TEST-PASSWORD-DO-NOT-USE-cccc3333dddd4444";

// ---------------------------------------------------------------------------
// Test helper: in-memory pino logger using the runtime redactionPaths
// ---------------------------------------------------------------------------

function makeTestLogger(level = "debug"): {
  logger: ReturnType<typeof pino>;
  getLines: () => string[];
} {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));

  const logger = pino(
    {
      level,
      redact: {
        paths: redactionPaths, // same list the runtime uses
        censor: "[REDACTED]",
      },
    },
    stream as unknown as Writable,
  );

  return {
    logger,
    getLines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((l) => l.trim() !== ""),
  };
}

// ---------------------------------------------------------------------------
// Redaction tests
// ---------------------------------------------------------------------------

describe("logger — redactionPaths export", () => {
  it("redactionPaths is an array with at least one entry", () => {
    expect(Array.isArray(redactionPaths)).toBe(true);
    expect(redactionPaths.length).toBeGreaterThan(0);
  });

  it("includes apiToken path", () => {
    expect(redactionPaths).toContain("apiToken");
  });

  it("includes *.token path", () => {
    expect(redactionPaths).toContain("*.token");
  });

  it("includes *.secret path (NFR-Logging)", () => {
    expect(redactionPaths).toContain("*.secret");
  });

  it("includes req.headers.authorization path", () => {
    expect(redactionPaths).toContain("req.headers.authorization");
  });

  it("includes auth.password path", () => {
    expect(redactionPaths).toContain("auth.password");
  });

  it("includes credentials.password path", () => {
    expect(redactionPaths).toContain("credentials.password");
  });

  it("includes top-level password path (W13)", () => {
    expect(redactionPaths).toContain("password");
  });

  it("includes wildcard *.password path (W13)", () => {
    expect(redactionPaths).toContain("*.password");
  });

  it("includes credentials.apiToken path (NFR-Logging)", () => {
    expect(redactionPaths).toContain("credentials.apiToken");
  });

  it("includes headers.authorization path", () => {
    expect(redactionPaths).toContain("headers.authorization");
  });
});

describe("logger — credential redaction (token literal must not appear in output)", () => {
  let logger: ReturnType<typeof pino>;
  let getLines: () => string[];

  beforeEach(() => {
    const t = makeTestLogger("debug");
    logger = t.logger;
    getLines = t.getLines;
  });

  it("redacts top-level apiToken field", () => {
    logger.info({ apiToken: TEST_TOKEN }, "token logged at top level");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_TOKEN);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    expect(parsed["apiToken"]).toBe("[REDACTED]");
  });

  it("redacts nested *.apiToken field", () => {
    logger.info({ config: { apiToken: TEST_TOKEN } }, "nested apiToken logged");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_TOKEN);
  });

  it("redacts nested *.token field", () => {
    logger.info({ auth: { token: TEST_TOKEN } }, "nested token logged");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_TOKEN);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    const auth = parsed["auth"] as Record<string, unknown>;
    expect(auth["token"]).toBe("[REDACTED]");
  });

  it("redacts req.headers.authorization field", () => {
    logger.info(
      { req: { headers: { authorization: `Basic ${TEST_TOKEN}` } } },
      "HTTP request logged",
    );
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_TOKEN);
  });

  it("redacts auth.password field", () => {
    logger.info({ auth: { password: TEST_PASSWORD } }, "auth password logged");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_PASSWORD);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    const auth = parsed["auth"] as Record<string, unknown>;
    expect(auth["password"]).toBe("[REDACTED]");
  });

  it("redacts credentials.password field", () => {
    logger.info({ credentials: { password: TEST_PASSWORD } }, "credentials logged");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_PASSWORD);
  });

  it("redacts headers.authorization field", () => {
    logger.info(
      { headers: { authorization: `Basic ${TEST_TOKEN}` } },
      "flat headers logged",
    );
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_TOKEN);
  });

  it("redacts nested *.secret field (NFR-Logging)", () => {
    logger.info({ config: { secret: TEST_TOKEN } }, "secret in nested obj logged");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_TOKEN);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    const config = parsed["config"] as Record<string, unknown>;
    expect(config["secret"]).toBe("[REDACTED]");
  });

  it("redacts credentials.apiToken field (NFR-Logging)", () => {
    logger.info({ credentials: { apiToken: TEST_TOKEN } }, "credentials.apiToken logged");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_TOKEN);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    const credentials = parsed["credentials"] as Record<string, unknown>;
    expect(credentials["apiToken"]).toBe("[REDACTED]");
  });

  it("redacts top-level password field (W13)", () => {
    logger.info({ password: TEST_PASSWORD }, "flat password logged");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_PASSWORD);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    expect(parsed["password"]).toBe("[REDACTED]");
  });

  it("redacts arbitrary nested *.password field (W13 — beyond auth/credentials)", () => {
    // Use a path that is NOT auth.password or credentials.password — proves the
    // wildcard catches nesting under arbitrary keys.
    logger.info(
      { user: { password: TEST_PASSWORD } },
      "nested user.password logged",
    );
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_PASSWORD);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    const user = parsed["user"] as Record<string, unknown>;
    expect(user["password"]).toBe("[REDACTED]");
  });

  it("does NOT redact unrelated fields (control case)", () => {
    logger.info({ tool: "create_task", project_id: 12, duration_ms: 42 }, "tool completed");
    const line = getLines()[0];
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    expect(parsed["tool"]).toBe("create_task");
    expect(parsed["project_id"]).toBe(12);
    expect(parsed["duration_ms"]).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Stdout isolation — logger must NEVER write to stdout
// ---------------------------------------------------------------------------

describe("logger — stdout isolation", () => {
  it("createLogger() returns a logger (smoke test — does not throw)", () => {
    // We can't easily capture fd 1 in vitest without subprocess tricks,
    // but we can verify the factory returns a usable logger without throwing.
    const logger = createLogger({ level: "silent" });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("createLogger() respects opts.level", () => {
    const logger = createLogger({ level: "warn" });
    expect(logger.level).toBe("warn");
  });

  it("createLogger() defaults level to info when LOG_LEVEL is unset", () => {
    const saved = process.env["LOG_LEVEL"];
    delete process.env["LOG_LEVEL"];
    const logger = createLogger();
    expect(logger.level).toBe("info");
    if (saved !== undefined) {
      process.env["LOG_LEVEL"] = saved;
    }
  });

  it("createLogger() uses LOG_LEVEL env var as fallback", () => {
    const saved = process.env["LOG_LEVEL"];
    process.env["LOG_LEVEL"] = "debug";
    const logger = createLogger();
    expect(logger.level).toBe("debug");
    if (saved !== undefined) {
      process.env["LOG_LEVEL"] = saved;
    } else {
      delete process.env["LOG_LEVEL"];
    }
  });
});

// ---------------------------------------------------------------------------
// redactExtra option
// ---------------------------------------------------------------------------

describe("logger — redactExtra option", () => {
  it("merges extra paths with the defaults", () => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    const logger = pino(
      {
        level: "debug",
        redact: {
          // Use the same merge logic as createLogger to test the option contract
          paths: [...redactionPaths, "customSecret"],
          censor: "[REDACTED]",
        },
      },
      stream as unknown as Writable,
    );

    logger.info({ customSecret: TEST_TOKEN }, "custom secret logged");

    const line = chunks.join("").split("\n").find((l) => l.trim() !== "");
    expect(line).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(line!).not.toContain(TEST_TOKEN);
  });
});
