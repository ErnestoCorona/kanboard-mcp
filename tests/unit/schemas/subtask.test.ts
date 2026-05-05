/**
 * Unit tests for src/schemas/subtask.ts
 */

import { describe, it, expect } from "vitest";
import { SubtaskSchema } from "../../../src/schemas/subtask.js";

const fullSubtaskFixture = {
  id: "10",
  task_id: "42",
  title: "Write unit tests",
  status: "1",
  user_id: "7",
  time_estimated: "2",
  time_spent: "1",
  position: "2",
};

describe("SubtaskSchema — happy path", () => {
  it("parses full subtask fixture", () => {
    const result = SubtaskSchema.parse(fullSubtaskFixture);
    expect(result.id).toBe(10);
    expect(result.task_id).toBe(42);
    expect(result.title).toBe("Write unit tests");
    expect(result.status).toBe(1);
    expect(result.user_id).toBe(7);
    expect(result.time_estimated).toBe(2);
    expect(result.time_spent).toBe(1);
  });

  it("status 0 (todo)", () => {
    const result = SubtaskSchema.parse({ ...fullSubtaskFixture, status: "0" });
    expect(result.status).toBe(0);
  });

  it("status 1 (in-progress)", () => {
    const result = SubtaskSchema.parse({ ...fullSubtaskFixture, status: "1" });
    expect(result.status).toBe(1);
  });

  it("status 2 (done)", () => {
    const result = SubtaskSchema.parse({ ...fullSubtaskFixture, status: "2" });
    expect(result.status).toBe(2);
  });
});

describe("SubtaskSchema — nullable FK edge cases", () => {
  it("user_id '0' → null", () => {
    const result = SubtaskSchema.parse({ ...fullSubtaskFixture, user_id: "0" });
    expect(result.user_id).toBeNull();
  });

  it("user_id '' → null", () => {
    const result = SubtaskSchema.parse({ ...fullSubtaskFixture, user_id: "" });
    expect(result.user_id).toBeNull();
  });

  it("user_id null → null", () => {
    const result = SubtaskSchema.parse({ ...fullSubtaskFixture, user_id: null });
    expect(result.user_id).toBeNull();
  });

  it("user_id '7' → 7", () => {
    const result = SubtaskSchema.parse({ ...fullSubtaskFixture, user_id: "7" });
    expect(result.user_id).toBe(7);
  });
});

describe("SubtaskSchema — passthrough", () => {
  it("ignores unknown fields", () => {
    expect(() =>
      SubtaskSchema.parse({ ...fullSubtaskFixture, unknown_field: "test" })
    ).not.toThrow();
  });
});
