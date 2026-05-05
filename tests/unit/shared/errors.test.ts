import { describe, it, expect } from "vitest";
import {
  KanboardApiError,
  AuthError,
  NotFoundError,
  ValidationError,
  ConfigError,
  TimeoutError,
} from "../../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// KanboardApiError (base)
// ---------------------------------------------------------------------------

describe("KanboardApiError", () => {
  it("sets name field correctly", () => {
    const err = new KanboardApiError("testMethod", "something failed");
    expect(err.name).toBe("KanboardApiError");
  });

  it("sets method and message fields", () => {
    const err = new KanboardApiError("getAllProjects", "internal error");
    expect(err.method).toBe("getAllProjects");
    expect(err.message).toBe("internal error");
  });

  it("is an instance of Error", () => {
    const err = new KanboardApiError("x", "y");
    expect(err).toBeInstanceOf(Error);
  });

  it("chains cause correctly via options", () => {
    const original = new Error("root cause");
    const err = new KanboardApiError("createTask", "wrapped", { cause: original });
    expect(err.cause).toBe(original);
  });

  it("carries optional code", () => {
    const err = new KanboardApiError("createTask", "failed", { code: -32603 });
    expect(err.code).toBe(-32603);
  });

  it("carries optional retryAfter", () => {
    const err = new KanboardApiError("getAllTasks", "rate limited", { retryAfter: 30 });
    expect(err.retryAfter).toBe(30);
  });

  it("code and retryAfter are undefined when not provided", () => {
    const err = new KanboardApiError("x", "y");
    expect(err.code).toBeUndefined();
    expect(err.retryAfter).toBeUndefined();
  });

  it("static is() returns true for KanboardApiError instance", () => {
    const err = new KanboardApiError("x", "y");
    expect(KanboardApiError.is(err)).toBe(true);
  });

  it("static is() returns true for subclass instance", () => {
    const err = new AuthError("x", "y");
    expect(KanboardApiError.is(err)).toBe(true);
  });

  it("static is() returns false for plain Error", () => {
    expect(KanboardApiError.is(new Error("plain"))).toBe(false);
  });

  it("static is() returns false for non-error values", () => {
    expect(KanboardApiError.is("string")).toBe(false);
    expect(KanboardApiError.is(null)).toBe(false);
    expect(KanboardApiError.is(42)).toBe(false);
  });

  it("toMcpToolResult() returns isError: true with API_ERROR prefix", () => {
    const err = new KanboardApiError("getTask", "not available");
    const result = err.toMcpToolResult();
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("API_ERROR");
    expect(result.content[0]?.text).toContain("getTask");
    expect(result.content[0]?.text).toContain("not available");
  });
});

// ---------------------------------------------------------------------------
// AuthError
// ---------------------------------------------------------------------------

describe("AuthError", () => {
  it("sets name field correctly", () => {
    const err = new AuthError("getMe", "invalid token");
    expect(err.name).toBe("AuthError");
  });

  it("is instanceof KanboardApiError", () => {
    const err = new AuthError("getMe", "bad creds");
    expect(err).toBeInstanceOf(KanboardApiError);
  });

  it("is instanceof Error", () => {
    const err = new AuthError("getMe", "bad creds");
    expect(err).toBeInstanceOf(Error);
  });

  it("static is() returns true for AuthError instance", () => {
    const err = new AuthError("getMe", "bad creds");
    expect(AuthError.is(err)).toBe(true);
  });

  it("static is() returns false for sibling NotFoundError", () => {
    const err = new NotFoundError("getTask", "not found");
    expect(AuthError.is(err)).toBe(false);
  });

  it("static is() returns false for base KanboardApiError", () => {
    const err = new KanboardApiError("x", "y");
    expect(AuthError.is(err)).toBe(false);
  });

  it("toMcpToolResult() contains AUTH_ERROR prefix", () => {
    const err = new AuthError("getMe", "wrong password");
    const result = err.toMcpToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("AUTH_ERROR");
    expect(result.content[0]?.text).toContain("getMe");
  });
});

// ---------------------------------------------------------------------------
// NotFoundError
// ---------------------------------------------------------------------------

describe("NotFoundError", () => {
  it("sets name field correctly", () => {
    const err = new NotFoundError("getProjectById", "project 999 not found");
    expect(err.name).toBe("NotFoundError");
  });

  it("is instanceof KanboardApiError", () => {
    const err = new NotFoundError("getTask", "task not found");
    expect(err).toBeInstanceOf(KanboardApiError);
  });

  it("static is() returns true for NotFoundError instance", () => {
    const err = new NotFoundError("getTask", "not found");
    expect(NotFoundError.is(err)).toBe(true);
  });

  it("static is() returns false for sibling AuthError", () => {
    const err = new AuthError("getMe", "bad creds");
    expect(NotFoundError.is(err)).toBe(false);
  });

  it("static is() returns false for sibling TimeoutError", () => {
    const err = new TimeoutError("getAllTasks", "timed out");
    expect(NotFoundError.is(err)).toBe(false);
  });

  it("toMcpToolResult() contains NOT_FOUND prefix", () => {
    const err = new NotFoundError("getProjectById", "no such project");
    const result = err.toMcpToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NOT_FOUND");
    expect(result.content[0]?.text).toContain("getProjectById");
  });
});

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------

describe("ValidationError", () => {
  it("sets name field correctly", () => {
    const err = new ValidationError("createTask", "title required");
    expect(err.name).toBe("ValidationError");
  });

  it("is instanceof KanboardApiError", () => {
    const err = new ValidationError("createTask", "bad input");
    expect(err).toBeInstanceOf(KanboardApiError);
  });

  it("carries details when provided", () => {
    const issues = [{ path: ["title"], message: "Required" }];
    const err = new ValidationError("createTask", "validation failed", issues);
    expect(err.details).toEqual(issues);
  });

  it("details is undefined when not provided", () => {
    const err = new ValidationError("createTask", "bad input");
    expect(err.details).toBeUndefined();
  });

  it("static is() returns true for ValidationError instance", () => {
    const err = new ValidationError("createTask", "bad input");
    expect(ValidationError.is(err)).toBe(true);
  });

  it("static is() returns false for sibling AuthError", () => {
    const err = new AuthError("getMe", "bad creds");
    expect(ValidationError.is(err)).toBe(false);
  });

  it("toMcpToolResult() contains VALIDATION_ERROR prefix", () => {
    const err = new ValidationError("createTask", "title is required");
    const result = err.toMcpToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("VALIDATION_ERROR");
    expect(result.content[0]?.text).toContain("createTask");
  });
});

// ---------------------------------------------------------------------------
// ConfigError
// ---------------------------------------------------------------------------

describe("ConfigError", () => {
  it("sets name field correctly", () => {
    const err = new ConfigError("KANBOARD_URL is missing");
    expect(err.name).toBe("ConfigError");
  });

  it("is instanceof Error", () => {
    const err = new ConfigError("bad config");
    expect(err).toBeInstanceOf(Error);
  });

  it("is NOT instanceof KanboardApiError", () => {
    const err = new ConfigError("bad config");
    expect(err).not.toBeInstanceOf(KanboardApiError);
  });

  it("carries details when provided", () => {
    const err = new ConfigError("missing env var", "KANBOARD_URL");
    expect(err.details).toBe("KANBOARD_URL");
  });

  it("details is undefined when not provided", () => {
    const err = new ConfigError("bad config");
    expect(err.details).toBeUndefined();
  });

  it("static is() returns true for ConfigError instance", () => {
    const err = new ConfigError("bad config");
    expect(ConfigError.is(err)).toBe(true);
  });

  it("static is() returns false for KanboardApiError instance", () => {
    const err = new KanboardApiError("x", "y");
    expect(ConfigError.is(err)).toBe(false);
  });

  it("static is() returns false for plain Error", () => {
    expect(ConfigError.is(new Error("plain"))).toBe(false);
  });

  it("toMcpToolResult() returns isError: true with CONFIG_ERROR prefix", () => {
    const err = new ConfigError("KANBOARD_URL is required");
    const result = err.toMcpToolResult();
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("CONFIG_ERROR");
    expect(result.content[0]?.text).toContain("KANBOARD_URL");
  });
});

// ---------------------------------------------------------------------------
// TimeoutError
// ---------------------------------------------------------------------------

describe("TimeoutError", () => {
  it("sets name field correctly", () => {
    const err = new TimeoutError("getAllTasks", "exceeded 15000ms");
    expect(err.name).toBe("TimeoutError");
  });

  it("is instanceof KanboardApiError", () => {
    const err = new TimeoutError("getAllTasks", "timed out");
    expect(err).toBeInstanceOf(KanboardApiError);
  });

  it("static is() returns true for TimeoutError instance", () => {
    const err = new TimeoutError("getAllTasks", "timed out");
    expect(TimeoutError.is(err)).toBe(true);
  });

  it("static is() returns false for sibling NotFoundError", () => {
    const err = new NotFoundError("getTask", "not found");
    expect(TimeoutError.is(err)).toBe(false);
  });

  it("static is() returns false for sibling AuthError", () => {
    const err = new AuthError("getMe", "bad creds");
    expect(TimeoutError.is(err)).toBe(false);
  });

  it("static is() returns false for sibling ValidationError", () => {
    const err = new ValidationError("createTask", "bad input");
    expect(TimeoutError.is(err)).toBe(false);
  });

  it("chains cause correctly", () => {
    const abortErr = new Error("AbortError");
    const err = new TimeoutError("getAllTasks", "timed out", { cause: abortErr });
    expect(err.cause).toBe(abortErr);
  });

  it("toMcpToolResult() contains TIMEOUT_ERROR prefix", () => {
    const err = new TimeoutError("getAllTasks", "exceeded 15000ms");
    const result = err.toMcpToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("TIMEOUT_ERROR");
    expect(result.content[0]?.text).toContain("getAllTasks");
  });
});

// ---------------------------------------------------------------------------
// Cross-class is() predicates — siblings return false
// ---------------------------------------------------------------------------

describe("static is() cross-class isolation", () => {
  it("AuthError.is() is false for NotFoundError", () => {
    expect(AuthError.is(new NotFoundError("x", "y"))).toBe(false);
  });

  it("NotFoundError.is() is false for ValidationError", () => {
    expect(NotFoundError.is(new ValidationError("x", "y"))).toBe(false);
  });

  it("ValidationError.is() is false for TimeoutError", () => {
    expect(ValidationError.is(new TimeoutError("x", "y"))).toBe(false);
  });

  it("TimeoutError.is() is false for AuthError", () => {
    expect(TimeoutError.is(new AuthError("x", "y"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toMcpToolResult() shape contract
// ---------------------------------------------------------------------------

describe("toMcpToolResult() shape contract", () => {
  it("always returns isError: true", () => {
    const errors = [
      new KanboardApiError("a", "b"),
      new AuthError("a", "b"),
      new NotFoundError("a", "b"),
      new ValidationError("a", "b"),
      new TimeoutError("a", "b"),
      new ConfigError("b"),
    ];
    for (const err of errors) {
      expect(err.toMcpToolResult().isError).toBe(true);
    }
  });

  it("always returns content array with exactly one text item", () => {
    const errors = [
      new KanboardApiError("a", "b"),
      new AuthError("a", "b"),
      new NotFoundError("a", "b"),
      new ValidationError("a", "b"),
      new TimeoutError("a", "b"),
      new ConfigError("b"),
    ];
    for (const err of errors) {
      const { content } = err.toMcpToolResult();
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");
      expect(typeof content[0]?.text).toBe("string");
    }
  });
});
