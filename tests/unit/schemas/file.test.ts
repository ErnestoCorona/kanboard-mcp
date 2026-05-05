/**
 * Unit tests for src/schemas/file.ts
 */

import { describe, it, expect } from "vitest";
import { FileAttachmentSchema } from "../../../src/schemas/file.js";

const fullFileFixture = {
  id: "3",
  task_id: "42",
  project_id: "1",
  name: "architecture.pdf",
  path: "tasks/42/architecture.pdf",
  is_image: "0",
  size: "204800",
  user_id: "7",
  date: "1746000000",
};

describe("FileAttachmentSchema — happy path", () => {
  it("parses full file fixture", () => {
    const result = FileAttachmentSchema.parse(fullFileFixture);
    expect(result.id).toBe(3);
    expect(result.task_id).toBe(42);
    expect(result.project_id).toBe(1);
    expect(result.name).toBe("architecture.pdf");
    expect(result.path).toBe("tasks/42/architecture.pdf");
    expect(result.is_image).toBe(false);
    expect(result.size).toBe(204800);
    expect(result.user_id).toBe(7);
    expect(result.date).toBe(new Date(1746000000 * 1000).toISOString());
  });

  it("is_image '1' → true (image file)", () => {
    const result = FileAttachmentSchema.parse({ ...fullFileFixture, is_image: "1" });
    expect(result.is_image).toBe(true);
  });

  it("is_image '0' → false (non-image file)", () => {
    const result = FileAttachmentSchema.parse({ ...fullFileFixture, is_image: "0" });
    expect(result.is_image).toBe(false);
  });

  it("date epoch → ISO 8601", () => {
    const result = FileAttachmentSchema.parse(fullFileFixture);
    expect(result.date).toContain("T");
    expect(result.date).toContain("Z");
  });
});

describe("FileAttachmentSchema — nullable FK edge cases", () => {
  it("user_id '0' → null", () => {
    const result = FileAttachmentSchema.parse({ ...fullFileFixture, user_id: "0" });
    expect(result.user_id).toBeNull();
  });

  it("user_id '' → null", () => {
    const result = FileAttachmentSchema.parse({ ...fullFileFixture, user_id: "" });
    expect(result.user_id).toBeNull();
  });

  it("user_id null → null", () => {
    const result = FileAttachmentSchema.parse({ ...fullFileFixture, user_id: null });
    expect(result.user_id).toBeNull();
  });

  it("user_id '7' → 7", () => {
    const result = FileAttachmentSchema.parse({ ...fullFileFixture, user_id: "7" });
    expect(result.user_id).toBe(7);
  });
});

describe("FileAttachmentSchema — date edge cases", () => {
  it("date '0' → falls back to epoch 0 ISO", () => {
    const result = FileAttachmentSchema.parse({ ...fullFileFixture, date: "0" });
    expect(result.date).toBe(new Date(0).toISOString());
  });

  it("date null → falls back to epoch 0 ISO", () => {
    const result = FileAttachmentSchema.parse({ ...fullFileFixture, date: null });
    expect(result.date).toBe(new Date(0).toISOString());
  });
});

describe("FileAttachmentSchema — passthrough", () => {
  it("ignores unknown fields", () => {
    expect(() =>
      FileAttachmentSchema.parse({ ...fullFileFixture, extra: "data" })
    ).not.toThrow();
  });
});
