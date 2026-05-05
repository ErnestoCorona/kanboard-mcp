/**
 * Unit tests for src/schemas/common.ts
 *
 * Tests all four Zod transforms in isolation:
 * - epochSeconds
 * - nullableForeignKey
 * - numericId
 * - kanboardBoolean
 */

import { describe, it, expect } from "vitest";
import {
  epochSeconds,
  nullableForeignKey,
  numericId,
  kanboardBoolean,
  nullableString,
} from "../../../src/schemas/common.js";

// ---------------------------------------------------------------------------
// epochSeconds
// ---------------------------------------------------------------------------

describe("epochSeconds", () => {
  it("converts a positive epoch integer to ISO string", () => {
    const epoch = 1746000000; // ~2025-04-30
    const result = epochSeconds.parse(epoch);
    expect(result).toBe(new Date(epoch * 1000).toISOString());
  });

  it("converts a positive epoch string to ISO string", () => {
    const epoch = 1746000000;
    const result = epochSeconds.parse(String(epoch));
    expect(result).toBe(new Date(epoch * 1000).toISOString());
  });

  it("returns null for 0 (integer)", () => {
    expect(epochSeconds.parse(0)).toBeNull();
  });

  it("returns null for '0' (string)", () => {
    expect(epochSeconds.parse("0")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(epochSeconds.parse("")).toBeNull();
  });

  it("returns null for null", () => {
    expect(epochSeconds.parse(null)).toBeNull();
  });

  it("returns null for negative number", () => {
    expect(epochSeconds.parse(-1)).toBeNull();
  });

  it("returns null for NaN string", () => {
    expect(epochSeconds.parse("not-a-number")).toBeNull();
  });

  it("handles a known epoch correctly (2026 range)", () => {
    // Use a real 2026 epoch and verify it round-trips through Date correctly
    const epoch = 1777492800;
    const result = epochSeconds.parse(epoch);
    expect(result).toBe(new Date(epoch * 1000).toISOString());
    // Sanity: result must be in 2026
    expect(result).toMatch(/^2026-/);
  });

  it("handles small valid epoch (1 second into Unix epoch)", () => {
    const result = epochSeconds.parse(1);
    expect(result).toBe(new Date(1000).toISOString());
  });
});

// ---------------------------------------------------------------------------
// nullableForeignKey
// ---------------------------------------------------------------------------

describe("nullableForeignKey", () => {
  it("returns null for '0' (string)", () => {
    expect(nullableForeignKey.parse("0")).toBeNull();
  });

  it("returns null for 0 (integer)", () => {
    expect(nullableForeignKey.parse(0)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(nullableForeignKey.parse("")).toBeNull();
  });

  it("returns null for null", () => {
    expect(nullableForeignKey.parse(null)).toBeNull();
  });

  it("returns number for valid positive string", () => {
    expect(nullableForeignKey.parse("5")).toBe(5);
  });

  it("returns number for valid positive integer", () => {
    expect(nullableForeignKey.parse(42)).toBe(42);
  });

  it("returns number for string '1'", () => {
    expect(nullableForeignKey.parse("1")).toBe(1);
  });

  it("returns null for negative number", () => {
    expect(nullableForeignKey.parse(-1)).toBeNull();
  });

  it("returns null for NaN string", () => {
    expect(nullableForeignKey.parse("abc")).toBeNull();
  });

  it("returns number for large ID", () => {
    expect(nullableForeignKey.parse("9999")).toBe(9999);
  });
});

// ---------------------------------------------------------------------------
// numericId
// ---------------------------------------------------------------------------

describe("numericId", () => {
  it("parses positive integer", () => {
    expect(numericId.parse(42)).toBe(42);
  });

  it("parses positive integer string", () => {
    expect(numericId.parse("42")).toBe(42);
  });

  it("parses '1'", () => {
    expect(numericId.parse("1")).toBe(1);
  });

  it("throws on 0", () => {
    expect(() => numericId.parse(0)).toThrow();
  });

  it("throws on '0'", () => {
    expect(() => numericId.parse("0")).toThrow();
  });

  it("throws on negative number", () => {
    expect(() => numericId.parse(-1)).toThrow();
  });

  it("throws on negative string", () => {
    expect(() => numericId.parse("-5")).toThrow();
  });

  it("throws on non-numeric string", () => {
    expect(() => numericId.parse("abc")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => numericId.parse("")).toThrow();
  });

  it("parses large valid ID", () => {
    expect(numericId.parse(100000)).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// kanboardBoolean
// ---------------------------------------------------------------------------

describe("kanboardBoolean", () => {
  it("true → true", () => {
    expect(kanboardBoolean.parse(true)).toBe(true);
  });

  it("false → false", () => {
    expect(kanboardBoolean.parse(false)).toBe(false);
  });

  it("1 → true", () => {
    expect(kanboardBoolean.parse(1)).toBe(true);
  });

  it("0 → false", () => {
    expect(kanboardBoolean.parse(0)).toBe(false);
  });

  it('"1" → true', () => {
    expect(kanboardBoolean.parse("1")).toBe(true);
  });

  it('"0" → false', () => {
    expect(kanboardBoolean.parse("0")).toBe(false);
  });

  it("rejects arbitrary strings", () => {
    expect(() => kanboardBoolean.parse("yes")).toThrow();
  });

  it("rejects null", () => {
    expect(() => kanboardBoolean.parse(null)).toThrow();
  });

  it("rejects undefined", () => {
    expect(() => kanboardBoolean.parse(undefined)).toThrow();
  });

  it("rejects number 2", () => {
    expect(() => kanboardBoolean.parse(2)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// nullableString
// ---------------------------------------------------------------------------

describe("nullableString", () => {
  it("passes through non-empty string", () => {
    expect(nullableString.parse("hello")).toBe("hello");
  });

  it("converts empty string to null", () => {
    expect(nullableString.parse("")).toBeNull();
  });

  it("passes through null", () => {
    expect(nullableString.parse(null)).toBeNull();
  });
});
