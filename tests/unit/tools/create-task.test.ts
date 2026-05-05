/**
 * Unit tests for src/tools/create-task.ts
 *
 * Strategy:
 * - resolveProjectContext mocked via vi.mock.
 * - KanboardHandler.createTask mocked with vi.fn().
 *
 * Cases covered:
 * - happy path: task created, returns task_id
 * - yaml defaults merged into createTask call (columnId, ownerId, categoryId, swimlaneId)
 * - explicit fields override yaml defaults
 * - Zod: extra fields rejected (.strict())
 * - Zod: title required and min length 1
 * - handler error propagated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTaskTool } from "../../../src/tools/create-task.js";
import { KanboardApiError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { CreateTaskInput } from "../../../src/handler/kanboard.js";

// ---------------------------------------------------------------------------
// Mock resolveProjectContext
// ---------------------------------------------------------------------------

vi.mock("../../../src/tools/kanboard-context.js", () => ({
  resolveProjectContext: vi.fn().mockResolvedValue({
    projectId: 12,
    yamlPath: "/repo/.kanboard.yaml",
    defaults: {},
  }),
}));

import { resolveProjectContext } from "../../../src/tools/kanboard-context.js";
const mockResolveProjectContext = vi.mocked(resolveProjectContext);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: { createTaskResult?: number | "throw" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  createTaskMock: ReturnType<typeof vi.fn>;
} {
  const createTaskMock = vi.fn<KanboardHandler["createTask"]>();

  if (overrides?.createTaskResult === "throw") {
    createTaskMock.mockRejectedValue(new KanboardApiError("createTask", "createTask failed"));
  } else {
    createTaskMock.mockResolvedValue(overrides?.createTaskResult ?? 101);
  }

  const deps = {
    handler: { createTask: createTaskMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, createTaskMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockResolveProjectContext.mockResolvedValue({
    projectId: 12,
    yamlPath: "/repo/.kanboard.yaml",
    defaults: {},
  });
});

describe("create_task — happy path", () => {
  it("creates a task and returns task_id and project_id", async () => {
    const { deps, createTaskMock } = buildDeps({ createTaskResult: 101 });

    const result = await createTaskTool.handler({ title: "New feature" }, deps);

    expect(createTaskMock).toHaveBeenCalledOnce();
    expect(result.structuredContent).toEqual({ task_id: 101, project_id: 12 });
  });

  it("content text mentions task_id and project_id", async () => {
    const { deps } = buildDeps({ createTaskResult: 55 });

    const result = await createTaskTool.handler({ title: "Another task" }, deps);

    expect(result.content[0].text).toContain("55");
    expect(result.content[0].text).toContain("12");
  });

  it("passes all optional fields to createTask", async () => {
    const { deps, createTaskMock } = buildDeps();

    await createTaskTool.handler(
      {
        title: "Full task",
        description: "Detailed description",
        column_id: 3,
        owner_id: 5,
        color_id: "red",
        date_due: "2026-06-01T00:00:00.000Z",
        category_id: 2,
        swimlane_id: 1,
        score: 5,
        priority: 2,
        reference: "ISSUE-99",
        tags: ["backend", "urgent"],
        date_started: "2026-04-28T09:00:00.000Z",
      },
      deps,
    );

    const callArgs = createTaskMock.mock.calls[0]?.[0] as CreateTaskInput | undefined;
    expect(callArgs?.title).toBe("Full task");
    expect(callArgs?.column_id).toBe(3);
    expect(callArgs?.swimlane_id).toBe(1);
    expect(callArgs?.tags).toEqual(["backend", "urgent"]);
  });
});

describe("create_task — yaml defaults merged", () => {
  it("uses yaml defaults for column_id, owner_id, category_id, swimlane_id when not provided", async () => {
    mockResolveProjectContext.mockResolvedValue({
      projectId: 12,
      yamlPath: "/repo/.kanboard.yaml",
      defaults: {
        columnId: 7,
        ownerId: 3,
        categoryId: 4,
        swimlaneId: 2,
      },
    });

    const { deps, createTaskMock } = buildDeps();

    await createTaskTool.handler({ title: "Task with yaml defaults" }, deps);

    const callArgs = createTaskMock.mock.calls[0]?.[0] as CreateTaskInput | undefined;
    expect(callArgs?.column_id).toBe(7);
    expect(callArgs?.owner_id).toBe(3);
    expect(callArgs?.category_id).toBe(4);
    expect(callArgs?.swimlane_id).toBe(2);
  });

  it("explicit fields override yaml defaults", async () => {
    mockResolveProjectContext.mockResolvedValue({
      projectId: 12,
      yamlPath: "/repo/.kanboard.yaml",
      defaults: {
        columnId: 7,
        ownerId: 3,
      },
    });

    const { deps, createTaskMock } = buildDeps();

    await createTaskTool.handler(
      { title: "Override task", column_id: 10, owner_id: 9 },
      deps,
    );

    const callArgs = createTaskMock.mock.calls[0]?.[0] as CreateTaskInput | undefined;
    expect(callArgs?.column_id).toBe(10);
    expect(callArgs?.owner_id).toBe(9);
  });
});

describe("create_task — Zod validation", () => {
  it("rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      createTaskTool.handler({ title: "Task", unknown_field: "oops" }, deps),
    ).rejects.toThrow();
  });

  it("rejects missing title", async () => {
    const { deps } = buildDeps();

    await expect(createTaskTool.handler({ description: "No title" }, deps)).rejects.toThrow();
  });

  it("rejects empty title (min 1)", async () => {
    const { deps } = buildDeps();

    await expect(createTaskTool.handler({ title: "" }, deps)).rejects.toThrow();
  });
});

describe("create_task — handler error propagation", () => {
  it("propagates KanboardApiError from createTask", async () => {
    const { deps } = buildDeps({ createTaskResult: "throw" });

    await expect(
      createTaskTool.handler({ title: "Failing task" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});

describe("create_task — date ISO→epoch conversion", () => {
  it("converts ISO 8601 date_due string to epoch seconds before calling handler", async () => {
    const { deps, createTaskMock } = buildDeps({ createTaskResult: 200 });
    const isoDate = "2026-06-01T00:00:00.000Z";
    const expectedEpoch = Math.floor(new Date(isoDate).getTime() / 1000);

    await createTaskTool.handler({ title: "Task with due date", date_due: isoDate }, deps);

    const callArgs = createTaskMock.mock.calls[0]?.[0] as CreateTaskInput | undefined;
    expect(callArgs?.date_due).toBe(expectedEpoch);
    expect(typeof callArgs?.date_due).toBe("number");
  });

  it("converts ISO 8601 date_started string to epoch seconds before calling handler", async () => {
    const { deps, createTaskMock } = buildDeps({ createTaskResult: 201 });
    const isoDate = "2026-05-01T08:00:00.000Z";
    const expectedEpoch = Math.floor(new Date(isoDate).getTime() / 1000);

    await createTaskTool.handler({ title: "Task with start date", date_started: isoDate }, deps);

    const callArgs = createTaskMock.mock.calls[0]?.[0] as CreateTaskInput | undefined;
    expect(callArgs?.date_started).toBe(expectedEpoch);
    expect(typeof callArgs?.date_started).toBe("number");
  });

  it("passes epoch number date_due through unchanged", async () => {
    const { deps, createTaskMock } = buildDeps({ createTaskResult: 202 });
    const epochSeconds = 1780185600;

    await createTaskTool.handler({ title: "Task epoch due", date_due: epochSeconds }, deps);

    const callArgs = createTaskMock.mock.calls[0]?.[0] as CreateTaskInput | undefined;
    expect(callArgs?.date_due).toBe(epochSeconds);
  });

  it("passes epoch number date_started through unchanged", async () => {
    const { deps, createTaskMock } = buildDeps({ createTaskResult: 203 });
    const epochSeconds = 1746086400;

    await createTaskTool.handler({ title: "Task epoch started", date_started: epochSeconds }, deps);

    const callArgs = createTaskMock.mock.calls[0]?.[0] as CreateTaskInput | undefined;
    expect(callArgs?.date_started).toBe(epochSeconds);
  });

  it("passes null date_due through as undefined (omits field)", async () => {
    const { deps, createTaskMock } = buildDeps({ createTaskResult: 204 });

    await createTaskTool.handler({ title: "Task null due", date_due: null }, deps);

    const callArgs = createTaskMock.mock.calls[0]?.[0] as CreateTaskInput | undefined;
    // null → isoToEpoch returns null → ?? undefined → field is undefined
    expect(callArgs?.date_due).toBeUndefined();
  });

  it("throws ValidationError for invalid date_due string", async () => {
    const { deps } = buildDeps();

    await expect(
      createTaskTool.handler({ title: "Bad date task", date_due: "not-a-date" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
