/**
 * Unit tests for src/tools/list-tasks.ts
 *
 * Strategy:
 * - KanboardHandler and Resolvers are mocked with vi.fn().
 * - resolveProjectContext is mocked via vi.mock to avoid filesystem/yaml dependencies.
 *
 * Cases covered:
 * - happy path: active tasks returned (status_id=1 default)
 * - happy path: closed tasks requested (status_id=0)
 * - project resolved from explicit project_id
 * - project resolved from yaml (mocked context)
 * - Zod input: extra fields rejected (.strict())
 * - Zod input: invalid status_id (not 0|1) rejected
 * - handler error propagated to caller
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { listTasksTool } from "../../../src/tools/list-tasks.js";
import { KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Task } from "../../../src/shared/types.js";

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
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_TASK: Task = {
  id: 1,
  project_id: 12,
  title: "Implement auth",
  description: "",
  status: true,
  column_id: 2,
  swimlane_id: 1,
  owner_id: null,
  creator_id: null,
  category_id: null,
  color_id: "blue",
  position: 1,
  priority: 0,
  score: 0,
  reference: "",
  tags: [],
  date_creation: "2026-04-27T10:00:00.000Z",
  date_modification: "2026-04-27T10:00:00.000Z",
  date_due: null,
  date_started: null,
  date_moved: null,
  date_completed: null,
  url: "https://pm.example.com/?controller=TaskViewController&action=show&task_id=1",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: { getAllTasksResult?: Task[] | "throw" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getAllTasksMock: ReturnType<typeof vi.fn>;
} {
  const getAllTasksMock = vi.fn<KanboardHandler["getAllTasks"]>();

  if (overrides?.getAllTasksResult === "throw") {
    getAllTasksMock.mockRejectedValue(
      new KanboardApiError("getAllTasks", "getAllTasks failed"),
    );
  } else {
    getAllTasksMock.mockResolvedValue(overrides?.getAllTasksResult ?? [FAKE_TASK]);
  }

  const deps = {
    handler: { getAllTasks: getAllTasksMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, getAllTasksMock };
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

describe("list_tasks — happy path", () => {
  it("returns active tasks with default status_id=1", async () => {
    const { deps, getAllTasksMock } = buildDeps();

    const result = await listTasksTool.handler({ project_id: 12 }, deps);

    expect(getAllTasksMock).toHaveBeenCalledWith({ project_id: 12, status_id: 1 });
    expect(result.structuredContent).toMatchObject({
      tasks: [FAKE_TASK],
      project_id: 12,
      status_id: 1,
    });
  });

  it("returns closed tasks when status_id=0", async () => {
    const { deps, getAllTasksMock } = buildDeps({ getAllTasksResult: [] });

    const result = await listTasksTool.handler({ project_id: 12, status_id: 0 }, deps);

    expect(getAllTasksMock).toHaveBeenCalledWith({ project_id: 12, status_id: 0 });
    expect(result.structuredContent).toMatchObject({ status_id: 0, tasks: [] });
  });

  it("returns empty array when no tasks exist", async () => {
    const { deps } = buildDeps({ getAllTasksResult: [] });

    const result = await listTasksTool.handler({ project_id: 12 }, deps);

    expect(result.structuredContent).toMatchObject({ tasks: [] });
  });

  it("uses resolved projectId from context resolver", async () => {
    mockResolveProjectContext.mockResolvedValue({
      projectId: 99,
      yamlPath: null,
      defaults: {},
    });
    const { deps, getAllTasksMock } = buildDeps();

    await listTasksTool.handler({}, deps);

    expect(getAllTasksMock).toHaveBeenCalledWith({ project_id: 99, status_id: 1 });
  });

  it("passes project_identifier to resolveProjectContext", async () => {
    const { deps } = buildDeps();

    await listTasksTool.handler({ project_identifier: "MYPROJ" }, deps);

    expect(mockResolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ explicitProjectIdentifier: "MYPROJ" }),
    );
  });
});

describe("list_tasks — Zod validation", () => {
  it("rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      listTasksTool.handler({ project_id: 12, unknown_field: "oops" }, deps),
    ).rejects.toThrow();
  });

  it("rejects invalid status_id (not 0|1)", async () => {
    const { deps } = buildDeps();

    await expect(
      listTasksTool.handler({ project_id: 12, status_id: 2 }, deps),
    ).rejects.toThrow();
  });
});

describe("list_tasks — handler error propagation", () => {
  it("propagates KanboardApiError from getAllTasks", async () => {
    const { deps } = buildDeps({ getAllTasksResult: "throw" });

    await expect(
      listTasksTool.handler({ project_id: 12 }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
