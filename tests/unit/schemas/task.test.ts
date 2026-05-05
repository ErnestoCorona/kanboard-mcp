/**
 * Unit tests for src/schemas/task.ts
 */

import { describe, it, expect } from "vitest";
import { TaskSchema } from "../../../src/schemas/task.js";

// Representative Kanboard getTask fixture (Kanboard returns all fields as strings)
const fullTaskFixture = {
  id: "42",
  project_id: "1",
  title: "Implement feature X",
  description: "Detailed description",
  is_active: "1",
  column_id: "5",
  swimlane_id: "0",
  owner_id: "7",
  creator_id: "3",
  category_id: "0",
  color_id: "red",
  position: "3",
  priority: "2",
  score: "5",
  reference: "TICKET-42",
  tags: ["frontend", "bug"],
  date_creation: "1746000000",
  date_modification: "1746100000",
  date_due: "0",
  date_started: "",
  date_moved: "1746050000",
  date_completed: null,
  url: "https://pm.example.com/task/42",
};

describe("TaskSchema — happy path", () => {
  it("parses full task fixture", () => {
    const result = TaskSchema.parse(fullTaskFixture);
    expect(result.id).toBe(42);
    expect(result.project_id).toBe(1);
    expect(result.title).toBe("Implement feature X");
    expect(result.description).toBe("Detailed description");
    expect(result.status).toBe(true); // is_active "1" → boolean true
    expect(result.column_id).toBe(5);
    expect(result.swimlane_id).toBeNull(); // "0" → null
    expect(result.owner_id).toBe(7);
    expect(result.creator_id).toBe(3);
    expect(result.category_id).toBeNull(); // "0" → null
    expect(result.color_id).toBe("red");
    expect(result.position).toBe(3);
    expect(result.priority).toBe(2);
    expect(result.score).toBe(5);
    expect(result.reference).toBe("TICKET-42");
    expect(result.tags).toEqual(["frontend", "bug"]);
    expect(result.url).toBe("https://pm.example.com/task/42");
  });

  it("normalizes date_creation epoch → ISO", () => {
    const result = TaskSchema.parse(fullTaskFixture);
    expect(result.date_creation).toBe(new Date(1746000000 * 1000).toISOString());
  });

  it("normalizes date_modification epoch → ISO", () => {
    const result = TaskSchema.parse(fullTaskFixture);
    expect(result.date_modification).toBe(new Date(1746100000 * 1000).toISOString());
  });

  it("normalizes date_due '0' → null", () => {
    const result = TaskSchema.parse(fullTaskFixture);
    expect(result.date_due).toBeNull();
  });

  it("normalizes date_started '' → null", () => {
    const result = TaskSchema.parse(fullTaskFixture);
    expect(result.date_started).toBeNull();
  });

  it("normalizes date_completed null → null", () => {
    const result = TaskSchema.parse(fullTaskFixture);
    expect(result.date_completed).toBeNull();
  });

  it("normalizes date_moved epoch → ISO", () => {
    const result = TaskSchema.parse(fullTaskFixture);
    expect(result.date_moved).toBe(new Date(1746050000 * 1000).toISOString());
  });
});

describe("TaskSchema — is_active / status mapping", () => {
  it("is_active '1' → status true", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, is_active: "1" });
    expect(result.status).toBe(true);
  });

  it("is_active '0' → status false", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, is_active: "0" });
    expect(result.status).toBe(false);
  });

  it("is_active 1 → status true", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, is_active: 1 });
    expect(result.status).toBe(true);
  });

  it("is_active 0 → status false", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, is_active: 0 });
    expect(result.status).toBe(false);
  });
});

describe("TaskSchema — nullable FK edge cases", () => {
  it("swimlane_id '0' → null", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, swimlane_id: "0" });
    expect(result.swimlane_id).toBeNull();
  });

  it("swimlane_id '' → null", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, swimlane_id: "" });
    expect(result.swimlane_id).toBeNull();
  });

  it("swimlane_id null → null", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, swimlane_id: null });
    expect(result.swimlane_id).toBeNull();
  });

  it("category_id '0' → null", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, category_id: "0" });
    expect(result.category_id).toBeNull();
  });

  it("owner_id '0' → null", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, owner_id: "0" });
    expect(result.owner_id).toBeNull();
  });

  it("creator_id '0' → null", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, creator_id: "0" });
    expect(result.creator_id).toBeNull();
  });

  it("column_id '0' → null", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, column_id: "0" });
    expect(result.column_id).toBeNull();
  });

  it("valid swimlane_id '3' → 3", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, swimlane_id: "3" });
    expect(result.swimlane_id).toBe(3);
  });
});

describe("TaskSchema — tags", () => {
  it("empty tags array stays empty", () => {
    const result = TaskSchema.parse({ ...fullTaskFixture, tags: [] });
    expect(result.tags).toEqual([]);
  });

  it("missing tags → default empty array", () => {
    const withoutTags = { ...fullTaskFixture };
    delete (withoutTags as Record<string, unknown>).tags;
    const result = TaskSchema.parse(withoutTags);
    expect(result.tags).toEqual([]);
  });
});

describe("TaskSchema — unknown fields (passthrough)", () => {
  it("parses task with extra unknown fields without throwing", () => {
    const withExtra = { ...fullTaskFixture, extra_field: "ignored" };
    expect(() => TaskSchema.parse(withExtra)).not.toThrow();
  });
});
