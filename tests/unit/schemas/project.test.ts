/**
 * Unit tests for src/schemas/project.ts
 */

import { describe, it, expect } from "vitest";
import { ProjectSchema } from "../../../src/schemas/project.js";

// Representative Kanboard getAllProjects / getProjectById fixture
const fullProjectFixture = {
  id: "1",
  name: "My Project",
  identifier: "MYPROJ",
  description: "Test project description",
  is_active: "1",
  is_public: "0",
  is_private: "0",
  token: "abc123token",
  owner_id: "7",
  default_swimlane: "Default swimlane",
  show_default_swimlane: "1",
  start_date: "1746000000",
  end_date: "0",
  url: "https://kanboard.example.com/project/1",
};

describe("ProjectSchema — happy path", () => {
  it("parses full project fixture", () => {
    const result = ProjectSchema.parse(fullProjectFixture);
    expect(result.id).toBe(1);
    expect(result.name).toBe("My Project");
    expect(result.identifier).toBe("MYPROJ");
    expect(result.description).toBe("Test project description");
    expect(result.is_active).toBe(true);
    expect(result.is_public).toBe(false);
    expect(result.is_private).toBe(false);
    expect(result.token).toBe("abc123token");
    expect(result.owner_id).toBe(7);
    expect(result.default_swimlane).toBe("Default swimlane");
    expect(result.show_default_swimlane).toBe(true);
    expect(typeof result.start_date).toBe("string");
    expect(result.start_date).toContain("T"); // ISO 8601
    expect(result.end_date).toBeNull(); // "0" → null
    expect(result.url).toBe("https://kanboard.example.com/project/1");
  });

  it("normalizes epoch start_date to ISO 8601", () => {
    const result = ProjectSchema.parse(fullProjectFixture);
    expect(result.start_date).toBe(new Date(1746000000 * 1000).toISOString());
  });

  it("normalizes end_date '0' → null", () => {
    const result = ProjectSchema.parse(fullProjectFixture);
    expect(result.end_date).toBeNull();
  });

  it("normalizes owner_id '7' → 7 (number)", () => {
    const result = ProjectSchema.parse(fullProjectFixture);
    expect(result.owner_id).toBe(7);
  });

  it("normalizes is_active '1' → true", () => {
    const result = ProjectSchema.parse(fullProjectFixture);
    expect(result.is_active).toBe(true);
  });
});

describe("ProjectSchema — nullable FK edge cases", () => {
  it("owner_id '0' → null", () => {
    const result = ProjectSchema.parse({ ...fullProjectFixture, owner_id: "0" });
    expect(result.owner_id).toBeNull();
  });

  it("owner_id '' → null", () => {
    const result = ProjectSchema.parse({ ...fullProjectFixture, owner_id: "" });
    expect(result.owner_id).toBeNull();
  });

  it("owner_id null → null", () => {
    const result = ProjectSchema.parse({ ...fullProjectFixture, owner_id: null });
    expect(result.owner_id).toBeNull();
  });

  it("owner_id 0 (integer) → null", () => {
    const result = ProjectSchema.parse({ ...fullProjectFixture, owner_id: 0 });
    expect(result.owner_id).toBeNull();
  });
});

describe("ProjectSchema — date edge cases", () => {
  it("start_date null → null", () => {
    const result = ProjectSchema.parse({ ...fullProjectFixture, start_date: null });
    expect(result.start_date).toBeNull();
  });

  it("start_date '0' → null", () => {
    const result = ProjectSchema.parse({ ...fullProjectFixture, start_date: "0" });
    expect(result.start_date).toBeNull();
  });

  it("start_date '' → null", () => {
    const result = ProjectSchema.parse({ ...fullProjectFixture, start_date: "" });
    expect(result.start_date).toBeNull();
  });

  it("valid epoch start_date produces ISO string", () => {
    const result = ProjectSchema.parse({
      ...fullProjectFixture,
      start_date: "1746000000",
    });
    expect(result.start_date).toBe(new Date(1746000000 * 1000).toISOString());
  });
});

describe("ProjectSchema — minimal fixture (missing optionals)", () => {
  it("parses minimal project with required fields only", () => {
    const minimal = {
      id: "2",
      name: "Minimal Project",
      is_active: "1",
      is_public: "0",
      is_private: "0",
      owner_id: "0",
      start_date: null,
      end_date: null,
    };
    const result = ProjectSchema.parse(minimal);
    expect(result.id).toBe(2);
    expect(result.name).toBe("Minimal Project");
    expect(result.identifier).toBe("");
    expect(result.description).toBe("");
    expect(result.owner_id).toBeNull();
    expect(result.start_date).toBeNull();
    expect(result.end_date).toBeNull();
  });
});

describe("ProjectSchema — unknown fields (passthrough)", () => {
  it("parses project with extra unknown fields without throwing", () => {
    const withExtra = {
      ...fullProjectFixture,
      future_kanboard_field: "some value",
      another_unknown: 42,
    };
    expect(() => ProjectSchema.parse(withExtra)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Bug regression: v0.1.0 — null/object fields rejected by schema
// Kanboard returns null for unset optional strings, and an object for url.
// ---------------------------------------------------------------------------

describe("ProjectSchema — null field handling (v0.1.0 regression)", () => {
  it("description: null → coerces to empty string", () => {
    const result = ProjectSchema.parse({ ...fullProjectFixture, description: null });
    expect(result.description).toBe("");
  });

  it("predefined_email_subjects: null → parses without throwing", () => {
    expect(() =>
      ProjectSchema.parse({ ...fullProjectFixture, predefined_email_subjects: null }),
    ).not.toThrow();
  });

  it("url as object {board, list} → exposes both URLs", () => {
    const boardUrl = "http://kanboard.example.com/?controller=BoardViewController&action=show&project_id=1";
    const listUrl  = "http://kanboard.example.com/?controller=TaskListController&action=show&project_id=1";
    const result = ProjectSchema.parse({
      ...fullProjectFixture,
      url: { board: boardUrl, list: listUrl },
    });
    expect(result.url).toEqual({ board: boardUrl, list: listUrl });
  });
});

// Real-world response shape from a Kanboard v1.2.50 instance (sanitized)
describe("ProjectSchema — real-world fixture", () => {
  const realWorldFixture = {
    id: 1,
    name: "Sandbox",
    is_active: 1,
    token: "",
    last_modified: 1777882647,
    is_public: 0,
    is_private: 0,
    description: null,
    identifier: "",
    start_date: "",
    end_date: "",
    owner_id: 13,
    priority_default: 0,
    priority_start: 0,
    priority_end: 3,
    email: null,
    predefined_email_subjects: null,
    per_swimlane_task_limits: 0,
    task_limit: 0,
    enable_global_tags: 1,
    url: {
      board:
        "http://kanboard.example.com/?controller=BoardViewController&action=show&project_id=1",
      list: "http://kanboard.example.com/?controller=TaskListController&action=show&project_id=1",
    },
  };

  it("parses the full real-world response without throwing", () => {
    expect(() => ProjectSchema.parse(realWorldFixture)).not.toThrow();
  });

  it("id, name, flags normalize correctly", () => {
    const result = ProjectSchema.parse(realWorldFixture);
    expect(result.id).toBe(1);
    expect(result.name).toBe("Sandbox");
    expect(result.is_active).toBe(true);
    expect(result.is_public).toBe(false);
    expect(result.is_private).toBe(false);
  });

  it("description null → empty string", () => {
    const result = ProjectSchema.parse(realWorldFixture);
    expect(result.description).toBe("");
  });

  it("email null in input does not cause parse failure", () => {
    // email is not mapped in the transform output (not part of Project type)
    expect(() => ProjectSchema.parse(realWorldFixture)).not.toThrow();
  });

  it("predefined_email_subjects null does not throw", () => {
    const result = ProjectSchema.parse(realWorldFixture);
    expect(result).toBeDefined();
  });

  it("url object exposes board and list URLs", () => {
    const result = ProjectSchema.parse(realWorldFixture);
    expect(result.url).toEqual({
      board: "http://kanboard.example.com/?controller=BoardViewController&action=show&project_id=1",
      list: "http://kanboard.example.com/?controller=TaskListController&action=show&project_id=1",
    });
  });

  it("start_date '' → null, end_date '' → null", () => {
    const result = ProjectSchema.parse(realWorldFixture);
    expect(result.start_date).toBeNull();
    expect(result.end_date).toBeNull();
  });

  it("owner_id 13 → 13 (number)", () => {
    const result = ProjectSchema.parse(realWorldFixture);
    expect(result.owner_id).toBe(13);
  });
});
