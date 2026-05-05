/**
 * Unit tests for src/tools/create-column.ts
 *
 * Strategy:
 * - resolveProjectContext mocked via vi.mock.
 * - KanboardHandler.addColumn mocked with vi.fn() — no HTTP.
 * - resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered (9):
 * 1. happy path: project_id + title → column_id returned, invalidate called once
 * 2. happy path: all optional fields (task_limit, description) forwarded
 * 3. project resolved by project_identifier
 * 4. project resolved from .kanboard.yaml (no explicit id/identifier)
 * 5. task_limit: 0 accepted (unlimited)
 * 6. task_limit: -1 rejected
 * 7. unknown fields rejected (.strict())
 * 8. KanboardApiError from addColumn propagated; resolver NOT invalidated
 * 9. resolver.invalidate called exactly once on success
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createColumnTool } from "../../../src/tools/create-column.js";
import { KanboardApiError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Mock resolveProjectContext
// ---------------------------------------------------------------------------

vi.mock("../../../src/tools/kanboard-context.js", () => ({
  resolveProjectContext: vi.fn(),
}));

import { resolveProjectContext } from "../../../src/tools/kanboard-context.js";
const mockResolveProjectContext = vi.mocked(resolveProjectContext);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOLVED_CTX = { projectId: 7, yamlPath: null, defaults: {} };
const YAML_CTX = { projectId: 99, yamlPath: "/repo/.kanboard.yaml", defaults: {} };

function buildDeps(overrides?: { addColumnResult?: number | "throw" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  addColumnMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const addColumnMock = vi.fn<KanboardHandler["addColumn"]>();

  if (overrides?.addColumnResult === "throw") {
    addColumnMock.mockRejectedValue(new KanboardApiError("addColumn", "addColumn failed"));
  } else {
    addColumnMock.mockResolvedValue(overrides?.addColumnResult ?? 42);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: { addColumn: addColumnMock } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, addColumnMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockResolveProjectContext.mockReset();
  mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
});

describe("create_column — happy path", () => {
  it("1. project_id + title → column_id returned, invalidate called once", async () => {
    const { deps, addColumnMock, invalidateMock } = buildDeps({ addColumnResult: 42 });

    const result = await createColumnTool.handler(
      { project_id: 7, title: "WIP" },
      deps,
    );

    expect(addColumnMock).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 7, title: "WIP" }),
    );
    expect(result.structuredContent).toEqual({ column_id: 42 });
    expect(invalidateMock).toHaveBeenCalledWith(7);
    expect(invalidateMock).toHaveBeenCalledOnce();
  });

  it("2. all optional fields forwarded", async () => {
    const { deps, addColumnMock } = buildDeps({ addColumnResult: 10 });

    await createColumnTool.handler(
      { project_id: 7, title: "Done", task_limit: 5, description: "Final column" },
      deps,
    );

    expect(addColumnMock).toHaveBeenCalledWith({
      project_id: 7,
      title: "Done",
      task_limit: 5,
      description: "Final column",
    });
  });

  it("3. resolved by project_identifier", async () => {
    const { deps } = buildDeps();

    await createColumnTool.handler(
      { project_identifier: "PRJ", title: "Sprint" },
      deps,
    );

    expect(mockResolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ explicitProjectIdentifier: "PRJ" }),
    );
  });

  it("4. resolved from .kanboard.yaml when neither id nor identifier supplied", async () => {
    mockResolveProjectContext.mockResolvedValue(YAML_CTX);
    const { deps, invalidateMock } = buildDeps({ addColumnResult: 55 });

    const result = await createColumnTool.handler({ title: "Backlog" }, deps);

    expect(result.structuredContent).toEqual({ column_id: 55 });
    expect(invalidateMock).toHaveBeenCalledWith(99);
  });

  it("5. task_limit: 0 accepted (unlimited)", async () => {
    const { deps, addColumnMock } = buildDeps();

    await createColumnTool.handler({ project_id: 7, title: "Backlog", task_limit: 0 }, deps);

    expect(addColumnMock).toHaveBeenCalledWith(
      expect.objectContaining({ task_limit: 0 }),
    );
  });
});

describe("create_column — Zod validation", () => {
  it("6. task_limit: -1 rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      createColumnTool.handler({ project_id: 7, title: "Bad", task_limit: -1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("7. unknown fields rejected (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      createColumnTool.handler({ project_id: 7, title: "OK", unknown: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("create_column — error propagation and resolver contract", () => {
  it("8. KanboardApiError propagated; resolver NOT invalidated on error", async () => {
    const { deps, invalidateMock } = buildDeps({ addColumnResult: "throw" });

    await expect(
      createColumnTool.handler({ project_id: 7, title: "Fail" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("9. resolver.invalidate called exactly once on success", async () => {
    const { deps, invalidateMock } = buildDeps({ addColumnResult: 42 });

    await createColumnTool.handler({ project_id: 7, title: "WIP" }, deps);

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(7);
  });
});
