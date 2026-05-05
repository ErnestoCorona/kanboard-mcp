/**
 * Unit tests for src/schemas/comment.ts
 */

import { describe, it, expect } from "vitest";
import { CommentSchema } from "../../../src/schemas/comment.js";

const fullCommentFixture = {
  id: "5",
  task_id: "42",
  user_id: "7",
  content: "This is a **markdown** comment",
  reference: "",
  visibility: "app-user",
  date_creation: "1746000000",
  date_modification: "1746000000",
};

describe("CommentSchema — happy path", () => {
  it("parses full comment fixture", () => {
    const result = CommentSchema.parse(fullCommentFixture);
    expect(result.id).toBe(5);
    expect(result.task_id).toBe(42);
    expect(result.user_id).toBe(7);
    expect(result.content).toBe("This is a **markdown** comment");
    expect(result.reference).toBe("");
    expect(result.visibility).toBe("app-user");
    expect(result.date_creation).toBe(new Date(1746000000 * 1000).toISOString());
    expect(result.date_modification).toBe(new Date(1746000000 * 1000).toISOString());
  });

  it("date_creation epoch → ISO", () => {
    const result = CommentSchema.parse(fullCommentFixture);
    expect(result.date_creation).toContain("T");
    expect(result.date_creation).toContain("Z");
  });

  it("date_modification epoch → ISO", () => {
    const result = CommentSchema.parse(fullCommentFixture);
    expect(result.date_modification).toContain("T");
    expect(result.date_modification).toContain("Z");
  });
});

describe("CommentSchema — date edge cases", () => {
  it("date_creation '0' → falls back to epoch 0 ISO", () => {
    const result = CommentSchema.parse({ ...fullCommentFixture, date_creation: "0" });
    expect(result.date_creation).toBe(new Date(0).toISOString());
  });

  it("date_creation null → falls back to epoch 0 ISO", () => {
    const result = CommentSchema.parse({ ...fullCommentFixture, date_creation: null });
    expect(result.date_creation).toBe(new Date(0).toISOString());
  });
});

describe("CommentSchema — permissively-included author fields", () => {
  it("parses author fields when present", () => {
    const withAuthor = {
      ...fullCommentFixture,
      name: "Ernesto Corona",
      username: "ernesto.corona",
      email: "ernesto.corona@example.com",
    };
    expect(() => CommentSchema.parse(withAuthor)).not.toThrow();
  });
});

describe("CommentSchema — passthrough", () => {
  it("ignores unknown fields", () => {
    expect(() =>
      CommentSchema.parse({ ...fullCommentFixture, extra: "data" })
    ).not.toThrow();
  });
});
