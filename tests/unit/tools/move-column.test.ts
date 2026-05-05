/**
 * Unit tests for src/tools/move-column.ts
 *
 * Strategy:
 * - KanboardHandler.getColumn and .changeColumnPosition mocked with vi.fn() — no HTTP.
 * - resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered (9):
 * 1. happy path result shape: { ok: true, column_id, position }
 * 2. position < 1 rejected
 * 3. position missing rejected (required)
 * 4. column_id missing rejected
 * 5. .strict() rejects unknown fields
 * 6. getColumn NotFoundError propagated; changeColumnPosition NOT called
 * 7. changeColumnPosition KanboardApiError propagated; resolver NOT invalidated
 * 8. resolver.invalidate called exactly once on success with getColumn's project_id
 * 9. happy full flow ordering: getColumn THEN changeColumnPosition THEN invalidate
 */

import { describe, it, expect, vi } from "vitest";
import { moveColumnTool } from "../../../src/tools/move-column.js";
import { KanboardApiError, NotFoundError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Column } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_COLUMN: Column = {
  id: 5,
  project_id: 12,
  title: "Backlog",
  position: 5,
  task_limit: 0,
  description: "",
  hide_in_dashboard: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: {
  getColumnResult?: Column | "throw-notfound";
  changeColumnPositionResult?: "throw-api";
}): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getColumnMock: ReturnType<typeof vi.fn>;
  changeColumnPositionMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const getColumnMock = vi.fn<KanboardHandler["getColumn"]>();
  if (overrides?.getColumnResult === "throw-notfound") {
    getColumnMock.mockRejectedValue(new NotFoundError("getColumn", "column not found"));
  } else {
    getColumnMock.mockResolvedValue(overrides?.getColumnResult ?? FAKE_COLUMN);
  }

  const changeColumnPositionMock = vi.fn<KanboardHandler["changeColumnPosition"]>();
  if (overrides?.changeColumnPositionResult === "throw-api") {
    changeColumnPositionMock.mockRejectedValue(
      new KanboardApiError("changeColumnPosition", "changeColumnPosition failed"),
    );
  } else {
    changeColumnPositionMock.mockResolvedValue(undefined);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: {
      getColumn: getColumnMock,
      changeColumnPosition: changeColumnPositionMock,
    } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, getColumnMock, changeColumnPositionMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("move_column — happy path", () => {
  it("1. returns { ok: true, column_id, position }", async () => {
    const { deps } = buildDeps();

    const result = await moveColumnTool.handler({ column_id: 5, position: 1 }, deps);

    expect(result.structuredContent).toEqual({ ok: true, column_id: 5, position: 1 });
  });

  it("9. full flow: getColumn THEN changeColumnPosition THEN invalidate", async () => {
    // Verify ordering via mock invocation order numbers.
    const { deps, getColumnMock, changeColumnPositionMock, invalidateMock } = buildDeps();

    await moveColumnTool.handler({ column_id: 5, position: 1 }, deps);

    // All three called once.
    expect(getColumnMock).toHaveBeenCalledOnce();
    expect(changeColumnPositionMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledOnce();

    // invocationCallOrder monotonically increases, so getColumn < changeColumnPosition < invalidate.
    const getOrder = getColumnMock.mock.invocationCallOrder[0] ?? 0;
    const changeOrder = changeColumnPositionMock.mock.invocationCallOrder[0] ?? 0;
    const invalidateOrder = invalidateMock.mock.invocationCallOrder[0] ?? 0;
    expect(getOrder).toBeLessThan(changeOrder);
    expect(changeOrder).toBeLessThan(invalidateOrder);
  });
});

describe("move_column — Zod validation", () => {
  it("2. position < 1 rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      moveColumnTool.handler({ column_id: 5, position: 0 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("3. position missing rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      moveColumnTool.handler({ column_id: 5 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("4. column_id missing rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      moveColumnTool.handler({ position: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("5. .strict() rejects unknown fields", async () => {
    const { deps } = buildDeps();

    await expect(
      moveColumnTool.handler({ column_id: 5, position: 1, extra: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("move_column — error propagation and resolver contract", () => {
  it("6. getColumn NotFoundError propagated; changeColumnPosition NOT called", async () => {
    const { deps, changeColumnPositionMock } = buildDeps({
      getColumnResult: "throw-notfound",
    });

    await expect(
      moveColumnTool.handler({ column_id: 999, position: 1 }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(changeColumnPositionMock).not.toHaveBeenCalled();
  });

  it("7. changeColumnPosition KanboardApiError propagated; resolver NOT invalidated", async () => {
    const { deps, invalidateMock } = buildDeps({
      changeColumnPositionResult: "throw-api",
    });

    await expect(
      moveColumnTool.handler({ column_id: 5, position: 1 }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("8. resolver.invalidate called exactly once on success with getColumn's project_id", async () => {
    const customColumn: Column = { ...FAKE_COLUMN, project_id: 77 };
    const { deps, invalidateMock } = buildDeps({ getColumnResult: customColumn });

    await moveColumnTool.handler({ column_id: 5, position: 2 }, deps);

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(77);
  });
});
