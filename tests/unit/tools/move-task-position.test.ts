/**
 * Unit tests for src/tools/move-task-position.ts
 *
 * Strategy:
 * - resolveProjectContext mocked via vi.mock.
 * - KanboardHandler.moveTaskPosition and Resolvers methods mocked.
 *
 * Cases covered:
 * - happy path: column_id provided directly
 * - happy path: column_name provided → resolveColumnIdByName called with it
 * - column_name not found → NotFoundError propagated (FR-11)
 * - column_id and column_name BOTH provided → ValidationError (Zod refine)
 * - neither column_id nor column_name → ValidationError (Zod refine)
 * - swimlane_id absent → resolveDefaultSwimlaneId called with ctx.defaults.swimlaneId (undefined)
 * - swimlane_id absent, yaml has default → resolveDefaultSwimlaneId called with yamlDefault
 * - swimlane_id explicit → resolveDefaultSwimlaneId NOT called
 * - handler error → resolvers.invalidate(projectId) called; error re-thrown
 * - Zod: extra fields rejected (.strict())
 * - Zod: position must be ≥ 1
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { moveTaskPositionTool } from "../../../src/tools/move-task-position.js";
import { KanboardApiError, NotFoundError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

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

interface DepsOverrides {
  moveTaskPositionResult?: "throw";
  resolveColumnIdByNameResult?: number | "throw";
  resolveDefaultSwimlaneIdResult?: number;
}

function buildDeps(overrides?: DepsOverrides): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  moveTaskPositionMock: ReturnType<typeof vi.fn>;
  resolveColumnIdByNameMock: ReturnType<typeof vi.fn>;
  resolveDefaultSwimlaneIdMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const moveTaskPositionMock = vi.fn<KanboardHandler["moveTaskPosition"]>();
  if (overrides?.moveTaskPositionResult === "throw") {
    moveTaskPositionMock.mockRejectedValue(
      new KanboardApiError("moveTaskPosition", "moveTaskPosition failed"),
    );
  } else {
    moveTaskPositionMock.mockResolvedValue(undefined);
  }

  const resolveColumnIdByNameMock = vi.fn<Resolvers["resolveColumnIdByName"]>();
  if (overrides?.resolveColumnIdByNameResult === "throw") {
    resolveColumnIdByNameMock.mockRejectedValue(
      new NotFoundError("resolveColumnIdByName", 'Column "Unknown" not found'),
    );
  } else {
    resolveColumnIdByNameMock.mockResolvedValue(overrides?.resolveColumnIdByNameResult ?? 5);
  }

  const resolveDefaultSwimlaneIdMock = vi.fn<Resolvers["resolveDefaultSwimlaneId"]>();
  resolveDefaultSwimlaneIdMock.mockResolvedValue(overrides?.resolveDefaultSwimlaneIdResult ?? 1);

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: { moveTaskPosition: moveTaskPositionMock } as unknown as KanboardHandler,
    resolvers: {
      resolveColumnIdByName: resolveColumnIdByNameMock,
      resolveDefaultSwimlaneId: resolveDefaultSwimlaneIdMock,
      invalidate: invalidateMock,
    } as unknown as Resolvers,
  };

  return {
    deps,
    moveTaskPositionMock,
    resolveColumnIdByNameMock,
    resolveDefaultSwimlaneIdMock,
    invalidateMock,
  };
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

describe("move_task_position — column_id provided directly", () => {
  it("passes column_id directly to moveTaskPosition without resolving by name", async () => {
    const { deps, moveTaskPositionMock, resolveColumnIdByNameMock } = buildDeps();

    await moveTaskPositionTool.handler(
      { task_id: 10, column_id: 3, position: 1 },
      deps,
    );

    expect(resolveColumnIdByNameMock).not.toHaveBeenCalled();
    expect(moveTaskPositionMock).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: 3, task_id: 10, position: 1 }),
    );
  });
});

describe("move_task_position — column_name resolution", () => {
  it("calls resolveColumnIdByName and passes resolved id to moveTaskPosition", async () => {
    const { deps, moveTaskPositionMock, resolveColumnIdByNameMock } = buildDeps({
      resolveColumnIdByNameResult: 7,
    });

    await moveTaskPositionTool.handler(
      { task_id: 10, column_name: "In Progress", position: 2 },
      deps,
    );

    expect(resolveColumnIdByNameMock).toHaveBeenCalledWith(12, "In Progress");
    expect(moveTaskPositionMock).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: 7 }),
    );
  });

  it("propagates NotFoundError when column_name not found (FR-11)", async () => {
    const { deps } = buildDeps({ resolveColumnIdByNameResult: "throw" });

    await expect(
      moveTaskPositionTool.handler(
        { task_id: 10, column_name: "Unknown Column", position: 1 },
        deps,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("move_task_position — Zod refine: column_id XOR column_name", () => {
  it("rejects when both column_id and column_name are provided", async () => {
    const { deps } = buildDeps();

    await expect(
      moveTaskPositionTool.handler(
        { task_id: 10, column_id: 3, column_name: "Backlog", position: 1 },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects when neither column_id nor column_name is provided", async () => {
    const { deps } = buildDeps();

    await expect(
      moveTaskPositionTool.handler({ task_id: 10, position: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("move_task_position — swimlane_id resolution", () => {
  it("calls resolveDefaultSwimlaneId with undefined when no yaml default and no explicit swimlane_id", async () => {
    mockResolveProjectContext.mockResolvedValue({
      projectId: 12,
      yamlPath: null,
      defaults: {},
    });

    const { deps, resolveDefaultSwimlaneIdMock } = buildDeps();

    await moveTaskPositionTool.handler(
      { task_id: 10, column_id: 3, position: 1 },
      deps,
    );

    expect(resolveDefaultSwimlaneIdMock).toHaveBeenCalledWith(12, undefined);
  });

  it("calls resolveDefaultSwimlaneId with yamlDefault when yaml has default_swimlane_id", async () => {
    mockResolveProjectContext.mockResolvedValue({
      projectId: 12,
      yamlPath: "/repo/.kanboard.yaml",
      defaults: { swimlaneId: 4 },
    });

    const { deps, resolveDefaultSwimlaneIdMock } = buildDeps({
      resolveDefaultSwimlaneIdResult: 4,
    });

    await moveTaskPositionTool.handler(
      { task_id: 10, column_id: 3, position: 1 },
      deps,
    );

    expect(resolveDefaultSwimlaneIdMock).toHaveBeenCalledWith(12, 4);
  });

  it("does NOT call resolveDefaultSwimlaneId when swimlane_id is explicit", async () => {
    const { deps, resolveDefaultSwimlaneIdMock } = buildDeps();

    await moveTaskPositionTool.handler(
      { task_id: 10, column_id: 3, swimlane_id: 2, position: 1 },
      deps,
    );

    expect(resolveDefaultSwimlaneIdMock).not.toHaveBeenCalled();
  });
});

describe("move_task_position — handler error → invalidate called", () => {
  it("calls resolvers.invalidate(projectId) when moveTaskPosition throws and re-throws", async () => {
    const { deps, invalidateMock } = buildDeps({ moveTaskPositionResult: "throw" });

    await expect(
      moveTaskPositionTool.handler(
        { task_id: 10, column_id: 3, swimlane_id: 1, position: 1 },
        deps,
      ),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).toHaveBeenCalledWith(12);
  });
});

describe("move_task_position — Zod validation", () => {
  it("rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      moveTaskPositionTool.handler(
        { task_id: 10, column_id: 3, position: 1, unknown_field: "oops" },
        deps,
      ),
    ).rejects.toThrow();
  });

  it("rejects position < 1", async () => {
    const { deps } = buildDeps();

    await expect(
      moveTaskPositionTool.handler({ task_id: 10, column_id: 3, position: 0 }, deps),
    ).rejects.toThrow();
  });

  it("rejects missing task_id", async () => {
    const { deps } = buildDeps();

    await expect(
      moveTaskPositionTool.handler({ column_id: 3, position: 1 }, deps),
    ).rejects.toThrow();
  });
});

describe("move_task_position — Zod default position", () => {
  it("uses default position=1 when omitted", async () => {
    const { deps, moveTaskPositionMock } = buildDeps();

    await moveTaskPositionTool.handler({ task_id: 10, column_id: 3 }, deps);

    expect(moveTaskPositionMock).toHaveBeenCalledWith(
      expect.objectContaining({ position: 1 }),
    );
  });
});

describe("move_task_position — happy path result shape", () => {
  it("returns ok: true with resolved ids", async () => {
    const { deps } = buildDeps({
      resolveDefaultSwimlaneIdResult: 2,
    });

    const result = await moveTaskPositionTool.handler(
      { task_id: 10, column_id: 5, swimlane_id: 2, position: 3 },
      deps,
    );

    expect(result.structuredContent).toMatchObject({
      ok: true,
      task_id: 10,
      column_id: 5,
      swimlane_id: 2,
      position: 3,
    });
  });
});
