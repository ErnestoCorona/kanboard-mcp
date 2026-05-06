/**
 * Unit tests for src/shared/confirm.ts
 *
 * Cases covered:
 * - confirm:true returns undefined (no throw).
 * - confirm:false throws ValidationError carrying the tool name.
 * - confirm:undefined (cast) throws ValidationError.
 * - error message contains the tool name and the confirm:true hint.
 */

import { describe, it, expect } from "vitest";
import { assertConfirmed } from "../../../src/shared/confirm.js";
import { ValidationError } from "../../../src/shared/errors.js";

describe("assertConfirmed", () => {
  it("returns void (undefined) when confirm is exactly true", () => {
    expect(() => {
      assertConfirmed("delete_task", true);
    }).not.toThrow();
  });

  it("throws ValidationError when confirm is false", () => {
    expect(() => {
      assertConfirmed("delete_task", false);
    }).toThrow(ValidationError);
  });

  it("throws ValidationError when confirm is missing (undefined)", () => {
    expect(() => {
      assertConfirmed("delete_project", undefined as unknown as boolean);
    }).toThrow(ValidationError);
  });

  it("throws ValidationError when confirm is a truthy non-boolean (1)", () => {
    expect(() => {
      assertConfirmed("delete_subtask", 1 as unknown as boolean);
    }).toThrow(ValidationError);
  });

  it("throws ValidationError when confirm is the string 'true'", () => {
    expect(() => {
      assertConfirmed("delete_comment", "true" as unknown as boolean);
    }).toThrow(ValidationError);
  });

  it("error message contains the tool name and confirm:true hint", () => {
    try {
      assertConfirmed("remove_project_user", false);
      expect.fail("assertConfirmed should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.method).toBe("remove_project_user");
      expect(ve.message).toContain("remove_project_user");
      expect(ve.message).toContain("confirm: true");
    }
  });
});
