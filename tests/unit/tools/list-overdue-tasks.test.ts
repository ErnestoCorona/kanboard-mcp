/**
 * Unit tests for src/tools/list-overdue-tasks.ts
 *
 * FR-13: list_overdue_tasks with 3-way scope dispatch:
 *   - "mine"    → getMyOverdueTasks()
 *   - "all"     → getOverdueTasks()
 *   - "project" → getOverdueTasksByProject(project_id)
 *
 * Strategy:
 * - KanboardHandler methods mocked with vi.fn().
 * - resolveProjectContext mocked via vi.mock for the "project" scope branch.
 *
 * Cases covered:
 * - scope="mine" (default) → getMyOverdueTasks called; others not called
 * - scope="all" → getOverdueTasks called; others not called
 * - scope="project" + project_id → getOverdueTasksByProject called with resolved id
 * - scope="project" + yaml fallback (via mock)
 * - default scope is "mine" (no input)
 * - empty array result
 * - content text is JSON
 * - Zod refine: scope="project" is allowed even without explicit project args (yaml fallback)
 * - Zod: extra fields rejected (.strict())
 * - handler errors propagated per branch
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { listOverdueTasksTool } from "../../../src/tools/list-overdue-tasks.js";
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

const FAKE_OVERDUE_TASK: Task = {
  id: 7,
  project_id: 12,
  title: "Overdue task",
  description: "",
  status: true,
  column_id: 2,
  swimlane_id: 1,
  owner_id: 3,
  creator_id: 3,
  category_id: null,
  color_id: "red",
  position: 1,
  priority: 1,
  score: 0,
  reference: "",
  tags: [],
  date_creation: "2026-03-01T00:00:00.000Z",
  date_modification: "2026-04-01T00:00:00.000Z",
  date_due: "2026-04-15T00:00:00.000Z",
  date_started: null,
  date_moved: null,
  date_completed: null,
  url: "https://pm.example.com/?task_id=7",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: {
  myOverdueTasks?: Task[] | "throw";
  allOverdueTasks?: Task[] | "throw";
  projectOverdueTasks?: Task[] | "throw";
}): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getMyOverdueTasksMock: ReturnType<typeof vi.fn>;
  getOverdueTasksMock: ReturnType<typeof vi.fn>;
  getOverdueTasksByProjectMock: ReturnType<typeof vi.fn>;
} {
  const getMyOverdueTasksMock = vi.fn<KanboardHandler["getMyOverdueTasks"]>();
  const getOverdueTasksMock = vi.fn<KanboardHandler["getOverdueTasks"]>();
  const getOverdueTasksByProjectMock = vi.fn<KanboardHandler["getOverdueTasksByProject"]>();

  // Setup getMyOverdueTasks
  if (overrides?.myOverdueTasks === "throw") {
    getMyOverdueTasksMock.mockRejectedValue(
      new KanboardApiError("getMyOverdueTasks", "getMyOverdueTasks failed"),
    );
  } else {
    getMyOverdueTasksMock.mockResolvedValue(overrides?.myOverdueTasks ?? [FAKE_OVERDUE_TASK]);
  }

  // Setup getOverdueTasks
  if (overrides?.allOverdueTasks === "throw") {
    getOverdueTasksMock.mockRejectedValue(
      new KanboardApiError("getOverdueTasks", "getOverdueTasks failed"),
    );
  } else {
    getOverdueTasksMock.mockResolvedValue(overrides?.allOverdueTasks ?? [FAKE_OVERDUE_TASK]);
  }

  // Setup getOverdueTasksByProject
  if (overrides?.projectOverdueTasks === "throw") {
    getOverdueTasksByProjectMock.mockRejectedValue(
      new KanboardApiError("getOverdueTasksByProject", "getOverdueTasksByProject failed"),
    );
  } else {
    getOverdueTasksByProjectMock.mockResolvedValue(
      overrides?.projectOverdueTasks ?? [FAKE_OVERDUE_TASK],
    );
  }

  const deps = {
    handler: {
      getMyOverdueTasks: getMyOverdueTasksMock,
      getOverdueTasks: getOverdueTasksMock,
      getOverdueTasksByProject: getOverdueTasksByProjectMock,
    } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return {
    deps,
    getMyOverdueTasksMock,
    getOverdueTasksMock,
    getOverdueTasksByProjectMock,
  };
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
// Tests — scope="mine"
// ---------------------------------------------------------------------------

describe('list_overdue_tasks — scope="mine"', () => {
  it('calls getMyOverdueTasks when scope="mine"', async () => {
    const { deps, getMyOverdueTasksMock, getOverdueTasksMock, getOverdueTasksByProjectMock } =
      buildDeps();

    await listOverdueTasksTool.handler({ scope: "mine" }, deps);

    expect(getMyOverdueTasksMock).toHaveBeenCalledOnce();
    expect(getOverdueTasksMock).not.toHaveBeenCalled();
    expect(getOverdueTasksByProjectMock).not.toHaveBeenCalled();
  });

  it("defaults to scope=mine when no input provided", async () => {
    const { deps, getMyOverdueTasksMock } = buildDeps();

    await listOverdueTasksTool.handler({}, deps);

    expect(getMyOverdueTasksMock).toHaveBeenCalledOnce();
  });

  it("returns { tasks } from getMyOverdueTasks", async () => {
    const { deps } = buildDeps();

    const result = await listOverdueTasksTool.handler({ scope: "mine" }, deps);

    expect(result.structuredContent).toMatchObject({ tasks: [FAKE_OVERDUE_TASK] });
  });

  it("returns empty array when nothing overdue for mine", async () => {
    const { deps } = buildDeps({ myOverdueTasks: [] });

    const result = await listOverdueTasksTool.handler({ scope: "mine" }, deps);

    expect(result.structuredContent).toMatchObject({ tasks: [] });
  });

  it("propagates KanboardApiError from getMyOverdueTasks", async () => {
    const { deps } = buildDeps({ myOverdueTasks: "throw" });

    await expect(
      listOverdueTasksTool.handler({ scope: "mine" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});

// ---------------------------------------------------------------------------
// Tests — scope="all"
// ---------------------------------------------------------------------------

describe('list_overdue_tasks — scope="all"', () => {
  it('calls getOverdueTasks when scope="all"', async () => {
    const { deps, getMyOverdueTasksMock, getOverdueTasksMock, getOverdueTasksByProjectMock } =
      buildDeps();

    await listOverdueTasksTool.handler({ scope: "all" }, deps);

    expect(getOverdueTasksMock).toHaveBeenCalledOnce();
    expect(getMyOverdueTasksMock).not.toHaveBeenCalled();
    expect(getOverdueTasksByProjectMock).not.toHaveBeenCalled();
  });

  it("returns { tasks } from getOverdueTasks", async () => {
    const { deps } = buildDeps();

    const result = await listOverdueTasksTool.handler({ scope: "all" }, deps);

    expect(result.structuredContent).toMatchObject({ tasks: [FAKE_OVERDUE_TASK] });
  });

  it("returns empty array when nothing overdue globally", async () => {
    const { deps } = buildDeps({ allOverdueTasks: [] });

    const result = await listOverdueTasksTool.handler({ scope: "all" }, deps);

    expect(result.structuredContent).toMatchObject({ tasks: [] });
  });

  it("propagates KanboardApiError from getOverdueTasks", async () => {
    const { deps } = buildDeps({ allOverdueTasks: "throw" });

    await expect(
      listOverdueTasksTool.handler({ scope: "all" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});

// ---------------------------------------------------------------------------
// Tests — scope="project"
// ---------------------------------------------------------------------------

describe('list_overdue_tasks — scope="project"', () => {
  it('calls getOverdueTasksByProject with resolved project_id when scope="project"', async () => {
    const { deps, getOverdueTasksByProjectMock, getMyOverdueTasksMock, getOverdueTasksMock } =
      buildDeps();

    await listOverdueTasksTool.handler({ scope: "project", project_id: 12 }, deps);

    expect(getOverdueTasksByProjectMock).toHaveBeenCalledOnce();
    expect(getOverdueTasksByProjectMock).toHaveBeenCalledWith(12);
    expect(getMyOverdueTasksMock).not.toHaveBeenCalled();
    expect(getOverdueTasksMock).not.toHaveBeenCalled();
  });

  it('passes explicit project_id to resolveProjectContext for scope="project"', async () => {
    const { deps } = buildDeps();

    await listOverdueTasksTool.handler({ scope: "project", project_id: 99 }, deps);

    expect(mockResolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ explicitProjectId: 99 }),
    );
  });

  it('passes explicit project_identifier to resolveProjectContext for scope="project"', async () => {
    const { deps } = buildDeps();

    await listOverdueTasksTool.handler({ scope: "project", project_identifier: "MYPROJ" }, deps);

    expect(mockResolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ explicitProjectIdentifier: "MYPROJ" }),
    );
  });

  it('uses yaml-resolved project_id when no explicit args for scope="project"', async () => {
    const { deps, getOverdueTasksByProjectMock } = buildDeps();
    // mockResolveProjectContext returns projectId: 12

    await listOverdueTasksTool.handler({ scope: "project" }, deps);

    expect(getOverdueTasksByProjectMock).toHaveBeenCalledWith(12);
  });

  it("returns { tasks } from getOverdueTasksByProject", async () => {
    const { deps } = buildDeps();

    const result = await listOverdueTasksTool.handler({ scope: "project", project_id: 12 }, deps);

    expect(result.structuredContent).toMatchObject({ tasks: [FAKE_OVERDUE_TASK] });
  });

  it("propagates KanboardApiError from getOverdueTasksByProject", async () => {
    const { deps } = buildDeps({ projectOverdueTasks: "throw" });

    await expect(
      listOverdueTasksTool.handler({ scope: "project", project_id: 12 }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});

// ---------------------------------------------------------------------------
// Tests — Zod validation
// ---------------------------------------------------------------------------

describe("list_overdue_tasks — Zod validation", () => {
  it("rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      listOverdueTasksTool.handler({ extra_param: "oops" }, deps),
    ).rejects.toThrow();
  });

  it("rejects invalid scope value", async () => {
    const { deps } = buildDeps();

    await expect(
      listOverdueTasksTool.handler({ scope: "invalid_scope" }, deps),
    ).rejects.toThrow();
  });

  it("accepts all valid scope values", async () => {
    const { deps } = buildDeps();

    await expect(listOverdueTasksTool.handler({ scope: "mine" }, deps)).resolves.toBeDefined();
    await expect(listOverdueTasksTool.handler({ scope: "all" }, deps)).resolves.toBeDefined();
    await expect(listOverdueTasksTool.handler({ scope: "project" }, deps)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — content text
// ---------------------------------------------------------------------------

describe("list_overdue_tasks — content text", () => {
  it("content text is parseable JSON with tasks array", async () => {
    const { deps } = buildDeps();

    const result = await listOverdueTasksTool.handler({ scope: "mine" }, deps);

    const parsed = JSON.parse(result.content[0].text) as { tasks: Task[] };
    expect(Array.isArray(parsed.tasks)).toBe(true);
    expect(parsed.tasks[0]?.id).toBe(7);
  });
});
