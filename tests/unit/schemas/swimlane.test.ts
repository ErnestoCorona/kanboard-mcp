/**
 * Unit tests for src/schemas/swimlane.ts
 */

import { describe, it, expect } from "vitest";
import { SwimlaneSchema } from "../../../src/schemas/swimlane.js";

const fullSwimlaneFixture = {
  id: "1",
  project_id: "1",
  name: "Default swimlane",
  description: "",
  position: "1",
  is_active: "1",
};

describe("SwimlaneSchema — happy path", () => {
  it("parses full swimlane fixture", () => {
    const result = SwimlaneSchema.parse(fullSwimlaneFixture);
    expect(result.id).toBe(1);
    expect(result.project_id).toBe(1);
    expect(result.name).toBe("Default swimlane");
    expect(result.description).toBe("");
    expect(result.position).toBe(1);
    expect(result.is_active).toBe(true);
  });

  it("is_active '0' → false (disabled swimlane)", () => {
    const result = SwimlaneSchema.parse({ ...fullSwimlaneFixture, is_active: "0" });
    expect(result.is_active).toBe(false);
  });

  it("is_active '1' → true", () => {
    const result = SwimlaneSchema.parse({ ...fullSwimlaneFixture, is_active: "1" });
    expect(result.is_active).toBe(true);
  });
});

describe("SwimlaneSchema — kanboardBoolean for is_active", () => {
  it("boolean true → true", () => {
    const result = SwimlaneSchema.parse({ ...fullSwimlaneFixture, is_active: true });
    expect(result.is_active).toBe(true);
  });

  it("integer 1 → true", () => {
    const result = SwimlaneSchema.parse({ ...fullSwimlaneFixture, is_active: 1 });
    expect(result.is_active).toBe(true);
  });

  it("integer 0 → false", () => {
    const result = SwimlaneSchema.parse({ ...fullSwimlaneFixture, is_active: 0 });
    expect(result.is_active).toBe(false);
  });
});

describe("SwimlaneSchema — passthrough", () => {
  it("ignores unknown fields (e.g. task_limit)", () => {
    expect(() =>
      SwimlaneSchema.parse({ ...fullSwimlaneFixture, task_limit: 10 })
    ).not.toThrow();
  });
});
