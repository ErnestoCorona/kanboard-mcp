/**
 * Unit tests for src/schemas/category.ts
 */

import { describe, it, expect } from "vitest";
import { CategorySchema } from "../../../src/schemas/category.js";

const fullCategoryFixture = {
  id: "2",
  project_id: "1",
  name: "Bug",
  color_id: "red",
};

describe("CategorySchema — happy path", () => {
  it("parses full category fixture", () => {
    const result = CategorySchema.parse(fullCategoryFixture);
    expect(result.id).toBe(2);
    expect(result.project_id).toBe(1);
    expect(result.name).toBe("Bug");
    expect(result.color_id).toBe("red");
  });

  it("id as integer string → number", () => {
    const result = CategorySchema.parse({ ...fullCategoryFixture, id: "10" });
    expect(result.id).toBe(10);
  });

  it("project_id as integer string → number", () => {
    const result = CategorySchema.parse({ ...fullCategoryFixture, project_id: "5" });
    expect(result.project_id).toBe(5);
  });
});

describe("CategorySchema — optional fields", () => {
  it("missing color_id defaults to empty string", () => {
    const minimal = { id: "3", project_id: "1", name: "Feature" };
    const result = CategorySchema.parse(minimal);
    expect(result.color_id).toBe("");
  });

  it("description field (permissive) ignored in output", () => {
    const withDesc = { ...fullCategoryFixture, description: "Category description" };
    const result = CategorySchema.parse(withDesc);
    // description is not in Category type — schema absorbs it via passthrough
    expect(result.id).toBe(2);
  });
});

describe("CategorySchema — passthrough", () => {
  it("ignores unknown fields", () => {
    expect(() =>
      CategorySchema.parse({ ...fullCategoryFixture, extra: "test" })
    ).not.toThrow();
  });
});
