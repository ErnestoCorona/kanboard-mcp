/**
 * Unit tests for src/tools/update-column.ts
 *
 * Strategy:
 * - KanboardHandler.getColumn and .updateColumn mocked with vi.fn() — no HTTP.
 * - resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered (11):
 * 1. happy path: rename → getColumn then updateColumn then invalidate(project_id)
 * 2. happy path: task_limit only → title omitted in tool call (handler resolves fallback)
 * 3. happy path: all 3 updatable fields
 * 4. .refine() rejects column_id-only → ValidationError (updateColumn NOT called)
 * 5. .strict() rejects unknown fields
 * 6. column_id ≤ 0 rejected
 * 7. task_limit: 0 accepted (unlimited)
 * 8. getColumn NotFoundError propagated; updateColumn NOT called; resolver NOT invalidated
 * 9. updateColumn KanboardApiError propagated; resolver NOT invalidated
 * 10. resolver.invalidate called with project_id from getColumn
 * 11. tool passes title:undefined to handler when omitted (handler-layer fallback owns the wire contract)
 */

import { describe, it, expect, vi } from "vitest";
import { updateColumnTool } from "../../../src/tools/update-column.js";
import { KanboardApiError, NotFoundError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Column } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_COLUMN: Column = {
  id: 3,
  project_id: 12,
  title: "In Progress",
  position: 2,
  task_limit: 0,
  description: "",
  hide_in_dashboard: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: {
  getColumnResult?: Column | "throw-notfound";
  updateColumnResult?: "throw-api";
}): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getColumnMock: ReturnType<typeof vi.fn>;
  updateColumnMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const getColumnMock = vi.fn<KanboardHandler["getColumn"]>();
  if (overrides?.getColumnResult === "throw-notfound") {
    getColumnMock.mockRejectedValue(new NotFoundError("getColumn", "column not found"));
  } else {
    getColumnMock.mockResolvedValue(overrides?.getColumnResult ?? FAKE_COLUMN);
  }

  const updateColumnMock = vi.fn<KanboardHandler["updateColumn"]>();
  if (overrides?.updateColumnResult === "throw-api") {
    updateColumnMock.mockRejectedValue(
      new KanboardApiError("updateColumn", "updateColumn failed"),
    );
  } else {
    updateColumnMock.mockResolvedValue(undefined);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: {
      getColumn: getColumnMock,
      updateColumn: updateColumnMock,
    } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, getColumnMock, updateColumnMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("update_column — happy path", () => {
  it("1. rename: getColumn → updateColumn → invalidate(project_id)", async () => {
    const { deps, getColumnMock, updateColumnMock, invalidateMock } = buildDeps();

    const result = await updateColumnTool.handler(
      { column_id: 3, title: "Renamed" },
      deps,
    );

    expect(getColumnMock).toHaveBeenCalledWith(3);
    expect(updateColumnMock).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: 3, title: "Renamed" }),
    );
    expect(invalidateMock).toHaveBeenCalledWith(12); // project_id from FAKE_COLUMN
    expect(result.structuredContent).toEqual({ ok: true, column_id: 3 });
  });

  it("2. task_limit only → title omitted in handler call (handler layer owns the wire fallback)", async () => {
    const { deps, updateColumnMock } = buildDeps();

    await updateColumnTool.handler({ column_id: 3, task_limit: 5 }, deps);

    // Tool forwards title:undefined to the handler — the handler fetches the existing
    // title internally (C4 fix). The tool is no longer responsible for the fallback.
    expect(updateColumnMock).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: 3, task_limit: 5, title: undefined }),
    );
  });

  it("3. all 3 updatable fields forwarded", async () => {
    const { deps, updateColumnMock } = buildDeps();

    await updateColumnTool.handler(
      { column_id: 3, title: "Done", task_limit: 3, description: "Final state" },
      deps,
    );

    expect(updateColumnMock).toHaveBeenCalledWith({
      column_id: 3,
      title: "Done",
      task_limit: 3,
      description: "Final state",
    });
  });

  it("7. task_limit: 0 accepted (unlimited)", async () => {
    const { deps, updateColumnMock } = buildDeps();

    await updateColumnTool.handler({ column_id: 3, task_limit: 0 }, deps);

    expect(updateColumnMock).toHaveBeenCalledWith(
      expect.objectContaining({ task_limit: 0 }),
    );
  });
});

describe("update_column — Zod validation", () => {
  it("4. .refine() rejects when only column_id provided → ValidationError; updateColumn NOT called", async () => {
    const { deps, updateColumnMock } = buildDeps();

    await expect(
      updateColumnTool.handler({ column_id: 3 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(updateColumnMock).not.toHaveBeenCalled();
  });

  it("5. .strict() rejects unknown fields", async () => {
    const { deps } = buildDeps();

    await expect(
      updateColumnTool.handler({ column_id: 3, title: "OK", mystery: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. column_id ≤ 0 rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      updateColumnTool.handler({ column_id: 0, title: "Bad" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("update_column — error propagation and resolver contract", () => {
  it("8. getColumn NotFoundError propagated; updateColumn NOT called; resolver NOT invalidated", async () => {
    const { deps, updateColumnMock, invalidateMock } = buildDeps({
      getColumnResult: "throw-notfound",
    });

    await expect(
      updateColumnTool.handler({ column_id: 999, title: "Ghost" }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(updateColumnMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("9. updateColumn KanboardApiError propagated; resolver NOT invalidated", async () => {
    const { deps, invalidateMock } = buildDeps({
      updateColumnResult: "throw-api",
    });

    await expect(
      updateColumnTool.handler({ column_id: 3, title: "Fail" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("10. resolver.invalidate called with project_id from getColumn", async () => {
    const customColumn: Column = { ...FAKE_COLUMN, project_id: 99 };
    const { deps, invalidateMock } = buildDeps({ getColumnResult: customColumn });

    await updateColumnTool.handler({ column_id: 3, title: "Renamed" }, deps);

    expect(invalidateMock).toHaveBeenCalledWith(99);
    expect(invalidateMock).toHaveBeenCalledOnce();
  });

  it("11. title omitted — tool calls getColumn once (for project_id), passes title:undefined to handler (C4)", async () => {
    const columnWithTitle: Column = { ...FAKE_COLUMN, title: "Existing Title", project_id: 12 };
    const { deps, getColumnMock, updateColumnMock } = buildDeps({ getColumnResult: columnWithTitle });

    await updateColumnTool.handler({ column_id: 3, task_limit: 5 }, deps);

    // Tool still calls getColumn once — needed to get project_id for resolver invalidation.
    expect(getColumnMock).toHaveBeenCalledOnce();
    expect(getColumnMock).toHaveBeenCalledWith(3);

    // Tool passes title:undefined to the handler — the handler owns the wire fallback (C4 fix).
    expect(updateColumnMock).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: 3, title: undefined, task_limit: 5 }),
    );
  });
});
