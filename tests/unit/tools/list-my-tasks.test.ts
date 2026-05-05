/**
 * Unit tests for src/tools/list-my-tasks.ts
 *
 * FR-12: list_my_tasks wraps searchTasks(project_id, "assignee:me status:open").
 *
 * Strategy:
 * - KanboardHandler.searchTasks mocked with vi.fn().
 * - resolveProjectContext mocked via vi.mock to avoid yaml/FS dependencies.
 *
 * Cases covered:
 * - happy path: explicit project_id → searchTasks called with correct query
 * - happy path: yaml-resolved project_id (via mock)
 * - returns { tasks: Task[] } (no subtasks)
 * - content text is JSON of the result
 * - Zod: extra fields rejected (.strict())
 * - handler searchTasks error propagated
 * - exact query string "assignee:me status:open" is sent
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { listMyTasksTool } from "../../../src/tools/list-my-tasks.js";
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
    yamlPath: "/project/.kanboard.yaml",
    defaults: {},
  }),
}));

import { resolveProjectContext } from "../../../src/tools/kanboard-context.js";
const mockResolveProjectContext = vi.mocked(resolveProjectContext);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_TASK: Task = {
  id: 5,
  project_id: 12,
  title: "My assigned task",
  description: "",
  status: true,
  column_id: 1,
  swimlane_id: 1,
  owner_id: 3,
  creator_id: 3,
  category_id: null,
  color_id: "blue",
  position: 1,
  priority: 0,
  score: 0,
  reference: "",
  tags: [],
  date_creation: "2026-04-01T00:00:00.000Z",
  date_modification: "2026-04-27T00:00:00.000Z",
  date_due: null,
  date_started: null,
  date_moved: null,
  date_completed: null,
  url: "https://pm.example.com/?task_id=5",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: { searchTasksResult?: Task[] | "throw" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  searchTasksMock: ReturnType<typeof vi.fn>;
} {
  const searchTasksMock = vi.fn<KanboardHandler["searchTasks"]>();

  if (overrides?.searchTasksResult === "throw") {
    searchTasksMock.mockRejectedValue(
      new KanboardApiError("searchTasks", "searchTasks failed"),
    );
  } else {
    searchTasksMock.mockResolvedValue(overrides?.searchTasksResult ?? [FAKE_TASK]);
  }

  const deps = {
    handler: { searchTasks: searchTasksMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, searchTasksMock };
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

afterEach(() => {
  mockResolveProjectContext.mockResolvedValue({
    projectId: 12,
    yamlPath: "/project/.kanboard.yaml",
    defaults: {},
  });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("list_my_tasks — happy path", () => {
  it("calls searchTasks with exact query 'assignee:me status:open'", async () => {
    const { deps, searchTasksMock } = buildDeps();

    await listMyTasksTool.handler({ project_id: 12 }, deps);

    expect(searchTasksMock).toHaveBeenCalledOnce();
    expect(searchTasksMock).toHaveBeenCalledWith({
      project_id: 12,
      query: "assignee:me status:open",
    });
  });

  it("uses project_id from resolved context (yaml-sourced)", async () => {
    const { deps, searchTasksMock } = buildDeps();

    // No explicit project_id — relies on mocked resolveProjectContext returning 12
    await listMyTasksTool.handler({}, deps);

    expect(searchTasksMock).toHaveBeenCalledWith({
      project_id: 12,
      query: "assignee:me status:open",
    });
  });

  it("returns { tasks: Task[] } without subtasks field", async () => {
    const { deps } = buildDeps();

    const result = await listMyTasksTool.handler({}, deps);

    expect(result.structuredContent).toMatchObject({ tasks: [FAKE_TASK] });
    // No subtasks field — spec says tasks only
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["subtasks"]).toBeUndefined();
  });

  it("returns empty tasks array when searchTasks returns []", async () => {
    const { deps } = buildDeps({ searchTasksResult: [] });

    const result = await listMyTasksTool.handler({}, deps);

    expect(result.structuredContent).toMatchObject({ tasks: [] });
  });

  it("content text is JSON of { tasks }", async () => {
    const { deps } = buildDeps();

    const result = await listMyTasksTool.handler({}, deps);

    const parsed = JSON.parse(result.content[0].text) as { tasks: Task[] };
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]?.id).toBe(5);
  });

  it("passes explicit project_id to resolveProjectContext", async () => {
    const { deps } = buildDeps();

    await listMyTasksTool.handler({ project_id: 99 }, deps);

    expect(mockResolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ explicitProjectId: 99 }),
    );
  });

  it("passes explicit project_identifier to resolveProjectContext", async () => {
    const { deps } = buildDeps();

    await listMyTasksTool.handler({ project_identifier: "MYPROJ" }, deps);

    expect(mockResolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ explicitProjectIdentifier: "MYPROJ" }),
    );
  });
});

describe("list_my_tasks — Zod validation", () => {
  it("rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      listMyTasksTool.handler({ extra_field: "oops" }, deps),
    ).rejects.toThrow();
  });

  it("accepts empty input (no project_id, no project_identifier)", async () => {
    const { deps } = buildDeps();

    // Should succeed — resolveProjectContext mock provides the project_id
    await expect(listMyTasksTool.handler({}, deps)).resolves.toBeDefined();
  });

  it("accepts project_id as positive integer", async () => {
    const { deps } = buildDeps();

    await expect(listMyTasksTool.handler({ project_id: 1 }, deps)).resolves.toBeDefined();
  });
});

describe("list_my_tasks — handler error propagation", () => {
  it("propagates KanboardApiError from searchTasks", async () => {
    const { deps } = buildDeps({ searchTasksResult: "throw" });

    await expect(
      listMyTasksTool.handler({}, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
