/**
 * Unit tests for src/schemas/dates.ts — isoToEpoch helper.
 *
 * Covers all branches:
 * - undefined passthrough
 * - null passthrough (clear semantics)
 * - valid ISO 8601 string → epoch seconds
 * - valid epoch number passthrough
 * - invalid string → ValidationError
 * - negative number → ValidationError
 * - non-finite number (NaN, Infinity) → ValidationError
 */

import { describe, it, expect } from "vitest";
import { isoToEpoch } from "../../../src/schemas/dates.js";
import { ValidationError } from "../../../src/shared/errors.js";

describe("isoToEpoch — undefined", () => {
  it("returns undefined when input is undefined", () => {
    expect(isoToEpoch(undefined)).toBeUndefined();
  });
});

describe("isoToEpoch — null", () => {
  it("returns null when input is null (clear semantics)", () => {
    expect(isoToEpoch(null)).toBeNull();
  });
});

describe("isoToEpoch — valid ISO 8601 string", () => {
  it("converts a UTC ISO 8601 datetime to epoch seconds", () => {
    const result = isoToEpoch("2026-06-01T00:00:00.000Z");
    // 2026-06-01T00:00:00.000Z → 1780185600 epoch seconds
    expect(result).toBe(Math.floor(new Date("2026-06-01T00:00:00.000Z").getTime() / 1000));
  });

  it("floors milliseconds (does not round)", () => {
    // A date with ms component — should floor, not round
    const result = isoToEpoch("2026-01-01T00:00:00.999Z");
    const expected = Math.floor(new Date("2026-01-01T00:00:00.999Z").getTime() / 1000);
    expect(result).toBe(expected);
  });

  it("handles date-only ISO string (no time component)", () => {
    const result = isoToEpoch("2026-04-28");
    const expected = Math.floor(new Date("2026-04-28").getTime() / 1000);
    expect(result).toBe(expected);
  });
});

describe("isoToEpoch — valid epoch number (passthrough)", () => {
  it("returns a positive epoch number as-is", () => {
    const epoch = 1780185600;
    expect(isoToEpoch(epoch)).toBe(epoch);
  });

  it("accepts zero as a valid epoch (epoch 0 = 1970-01-01)", () => {
    expect(isoToEpoch(0)).toBe(0);
  });
});

describe("isoToEpoch — invalid string → ValidationError", () => {
  it("throws ValidationError for a completely invalid string", () => {
    expect(() => isoToEpoch("not-a-date")).toThrow(ValidationError);
  });

  it("throws ValidationError for empty string", () => {
    expect(() => isoToEpoch("")).toThrow(ValidationError);
  });

  it("throws ValidationError for a random non-date string", () => {
    expect(() => isoToEpoch("banana")).toThrow(ValidationError);
  });

  it("includes the field name in the error message", () => {
    try {
      isoToEpoch("bad-date", "date_due");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toContain("date_due");
    }
  });
});

describe("isoToEpoch — invalid number → ValidationError", () => {
  it("throws ValidationError for negative epoch", () => {
    expect(() => isoToEpoch(-1)).toThrow(ValidationError);
  });

  it("throws ValidationError for NaN", () => {
    expect(() => isoToEpoch(NaN)).toThrow(ValidationError);
  });

  it("throws ValidationError for Infinity", () => {
    expect(() => isoToEpoch(Infinity)).toThrow(ValidationError);
  });

  it("includes the field name in the error message for negative number", () => {
    try {
      isoToEpoch(-1000, "date_started");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toContain("date_started");
    }
  });
});
