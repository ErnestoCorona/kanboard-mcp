/**
 * Unit tests for src/tools/delete-column.ts
 *
 * Strategy:
 * - KanboardHandler.getColumn and .removeColumn mocked — no HTTP.
 * - resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered:
 * 1. happy path: { ok: true, column_id } returned, removeColumn called with column_id
 * 2. response text mentions column id
 * 3. missing confirm rejected (Zod z.literal(true))
 * 4. confirm: false rejected (Zod)
 * 5. extra fields rejected (.strict())
 * 6. non-positive column_id rejected
 * 7. getColumn NotFoundError propagated; removeColumn NOT called; resolver NOT invalidated
 * 8. removeColumn KanboardApiError propagated; resolver NOT invalidated
 * 9. resolver.invalidate called once on success with project_id from getColumn
 * 10. removeColumn NOT called when confirm gate fails (string "true" rejected)
 */

import { describe, it, expect, vi } from "vitest";
import { deleteColumnTool } from "../../../src/tools/delete-column.js";
import {
  KanboardApiError,
  NotFoundError,
  ValidationError,
} from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Column } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_COLUMN: Column = {
  id: 7,
  project_id: 12,
  title: "Backlog",
  position: 1,
  task_limit: 0,
  description: "",
  hide_in_dashboard: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: {
  getColumnResult?: Column | "throw-notfound";
  removeColumnResult?: "throw-api";
}): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getColumnMock: ReturnType<typeof vi.fn>;
  removeColumnMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const getColumnMock = vi.fn<KanboardHandler["getColumn"]>();
  if (overrides?.getColumnResult === "throw-notfound") {
    getColumnMock.mockRejectedValue(new NotFoundError("getColumn", "column not found"));
  } else {
    getColumnMock.mockResolvedValue(overrides?.getColumnResult ?? FAKE_COLUMN);
  }

  const removeColumnMock = vi.fn<KanboardHandler["removeColumn"]>();
  if (overrides?.removeColumnResult === "throw-api") {
    removeColumnMock.mockRejectedValue(
      new KanboardApiError("removeColumn", "removeColumn failed"),
    );
  } else {
    removeColumnMock.mockResolvedValue(undefined);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: {
      getColumn: getColumnMock,
      removeColumn: removeColumnMock,
    } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, getColumnMock, removeColumnMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("delete_column — happy path", () => {
  it("1. deletes column and returns { ok: true, column_id }", async () => {
    const { deps, removeColumnMock } = buildDeps();

    const result = await deleteColumnTool.handler({ column_id: 7, confirm: true }, deps);

    expect(removeColumnMock).toHaveBeenCalledOnce();
    expect(removeColumnMock).toHaveBeenCalledWith(7);
    expect(result.structuredContent).toEqual({ ok: true, column_id: 7 });
  });

  it("2. response text mentions column id", async () => {
    const { deps } = buildDeps();

    const result = await deleteColumnTool.handler({ column_id: 42, confirm: true }, deps);

    expect(result.content[0].text).toContain("42");
  });
});

describe("delete_column — confirm gate", () => {
  it("3. rejects when confirm is missing", async () => {
    const { deps, removeColumnMock } = buildDeps();

    await expect(
      deleteColumnTool.handler({ column_id: 7 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeColumnMock).not.toHaveBeenCalled();
  });

  it("4. rejects when confirm is false", async () => {
    const { deps, removeColumnMock } = buildDeps();

    await expect(
      deleteColumnTool.handler({ column_id: 7, confirm: false }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeColumnMock).not.toHaveBeenCalled();
  });

  it("10. removeColumn NOT called when confirm gate fails (string 'true' rejected)", async () => {
    const { deps, removeColumnMock, getColumnMock } = buildDeps();

    await expect(
      deleteColumnTool.handler({ column_id: 7, confirm: "true" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeColumnMock).not.toHaveBeenCalled();
    expect(getColumnMock).not.toHaveBeenCalled();
  });
});

describe("delete_column — Zod validation", () => {
  it("5. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteColumnTool.handler({ column_id: 7, confirm: true, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. rejects non-positive column_id", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteColumnTool.handler({ column_id: 0, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deleteColumnTool.handler({ column_id: -1, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("delete_column — handler error propagation and resolver contract", () => {
  it("7. getColumn NotFoundError propagated; removeColumn NOT called; resolver NOT invalidated", async () => {
    const { deps, removeColumnMock, invalidateMock } = buildDeps({
      getColumnResult: "throw-notfound",
    });

    await expect(
      deleteColumnTool.handler({ column_id: 999, confirm: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(removeColumnMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("8. removeColumn KanboardApiError propagated; resolver NOT invalidated", async () => {
    const { deps, invalidateMock } = buildDeps({ removeColumnResult: "throw-api" });

    await expect(
      deleteColumnTool.handler({ column_id: 7, confirm: true }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("9. resolver.invalidate called once on success with project_id from getColumn", async () => {
    const customColumn: Column = { ...FAKE_COLUMN, project_id: 99 };
    const { deps, invalidateMock } = buildDeps({ getColumnResult: customColumn });

    await deleteColumnTool.handler({ column_id: 7, confirm: true }, deps);

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(99);
  });
});
