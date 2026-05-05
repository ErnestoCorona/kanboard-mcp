/**
 * Unit tests for src/schemas/column.ts
 */

import { describe, it, expect } from "vitest";
import { ColumnSchema } from "../../../src/schemas/column.js";

const fullColumnFixture = {
  id: "3",
  project_id: "1",
  title: "In Progress",
  position: "2",
  task_limit: "5",
  description: "Tasks actively being worked on",
  hide_in_dashboard: "0",
};

describe("ColumnSchema — happy path", () => {
  it("parses full column fixture", () => {
    const result = ColumnSchema.parse(fullColumnFixture);
    expect(result.id).toBe(3);
    expect(result.project_id).toBe(1);
    expect(result.title).toBe("In Progress");
    expect(result.position).toBe(2);
    expect(result.task_limit).toBe(5);
    expect(result.description).toBe("Tasks actively being worked on");
    expect(result.hide_in_dashboard).toBe(false);
  });

  it("hide_in_dashboard '1' → true", () => {
    const result = ColumnSchema.parse({ ...fullColumnFixture, hide_in_dashboard: "1" });
    expect(result.hide_in_dashboard).toBe(true);
  });

  it("hide_in_dashboard '0' → false", () => {
    const result = ColumnSchema.parse({ ...fullColumnFixture, hide_in_dashboard: "0" });
    expect(result.hide_in_dashboard).toBe(false);
  });

  it("task_limit 0 means unlimited", () => {
    const result = ColumnSchema.parse({ ...fullColumnFixture, task_limit: "0" });
    expect(result.task_limit).toBe(0);
  });
});

describe("ColumnSchema — kanboardBoolean for hide_in_dashboard", () => {
  it("boolean true → true", () => {
    const result = ColumnSchema.parse({ ...fullColumnFixture, hide_in_dashboard: true });
    expect(result.hide_in_dashboard).toBe(true);
  });

  it("boolean false → false", () => {
    const result = ColumnSchema.parse({ ...fullColumnFixture, hide_in_dashboard: false });
    expect(result.hide_in_dashboard).toBe(false);
  });

  it("integer 1 → true", () => {
    const result = ColumnSchema.parse({ ...fullColumnFixture, hide_in_dashboard: 1 });
    expect(result.hide_in_dashboard).toBe(true);
  });

  it("integer 0 → false", () => {
    const result = ColumnSchema.parse({ ...fullColumnFixture, hide_in_dashboard: 0 });
    expect(result.hide_in_dashboard).toBe(false);
  });
});

describe("ColumnSchema — passthrough", () => {
  it("ignores unknown fields", () => {
    expect(() =>
      ColumnSchema.parse({ ...fullColumnFixture, future_field: 99 })
    ).not.toThrow();
  });
});
