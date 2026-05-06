/**
 * Unit tests for src/tools/update-swimlane.ts
 *
 * Strategy:
 * - KanboardHandler.getSwimlane and .updateSwimlane mocked with vi.fn() — no HTTP.
 * - resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered:
 * 1. happy path: rename → getSwimlane then updateSwimlane then invalidate(project_id)
 * 2. happy path: description only
 * 3. happy path: both fields forwarded
 * 4. .refine() rejects swimlane_id-only → ValidationError (updateSwimlane NOT called)
 * 5. .strict() rejects unknown fields
 * 6. swimlane_id ≤ 0 rejected
 * 7. getSwimlane NotFoundError propagated; updateSwimlane NOT called; resolver NOT invalidated
 * 8. updateSwimlane KanboardApiError propagated; resolver NOT invalidated
 * 9. resolver.invalidate called with project_id from getSwimlane
 */

import { describe, it, expect, vi } from "vitest";
import { updateSwimlaneTool } from "../../../src/tools/update-swimlane.js";
import { KanboardApiError, NotFoundError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Swimlane } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_SWIMLANE: Swimlane = {
  id: 3,
  project_id: 12,
  name: "Default",
  description: "",
  position: 1,
  is_active: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: {
  getSwimlaneResult?: Swimlane | "throw-notfound";
  updateSwimlaneResult?: "throw-api";
}): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getSwimlaneMock: ReturnType<typeof vi.fn>;
  updateSwimlaneMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const getSwimlaneMock = vi.fn<KanboardHandler["getSwimlane"]>();
  if (overrides?.getSwimlaneResult === "throw-notfound") {
    getSwimlaneMock.mockRejectedValue(new NotFoundError("getSwimlane", "swimlane not found"));
  } else {
    getSwimlaneMock.mockResolvedValue(overrides?.getSwimlaneResult ?? FAKE_SWIMLANE);
  }

  const updateSwimlaneMock = vi.fn<KanboardHandler["updateSwimlane"]>();
  if (overrides?.updateSwimlaneResult === "throw-api") {
    updateSwimlaneMock.mockRejectedValue(
      new KanboardApiError("updateSwimlane", "updateSwimlane failed"),
    );
  } else {
    updateSwimlaneMock.mockResolvedValue(undefined);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: {
      getSwimlane: getSwimlaneMock,
      updateSwimlane: updateSwimlaneMock,
    } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, getSwimlaneMock, updateSwimlaneMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("update_swimlane — happy path", () => {
  it("1. rename: getSwimlane → updateSwimlane → invalidate(project_id)", async () => {
    const { deps, getSwimlaneMock, updateSwimlaneMock, invalidateMock } = buildDeps();

    const result = await updateSwimlaneTool.handler(
      { swimlane_id: 3, name: "Renamed" },
      deps,
    );

    expect(getSwimlaneMock).toHaveBeenCalledWith(3);
    expect(updateSwimlaneMock).toHaveBeenCalledWith(
      expect.objectContaining({ swimlane_id: 3, name: "Renamed" }),
    );
    expect(invalidateMock).toHaveBeenCalledWith(12);
    expect(result.structuredContent).toEqual({ ok: true, swimlane_id: 3 });
  });

  it("2. description only", async () => {
    const { deps, updateSwimlaneMock } = buildDeps();

    await updateSwimlaneTool.handler({ swimlane_id: 3, description: "New desc" }, deps);

    expect(updateSwimlaneMock).toHaveBeenCalledWith(
      expect.objectContaining({ swimlane_id: 3, description: "New desc" }),
    );
  });

  it("3. both fields forwarded", async () => {
    const { deps, updateSwimlaneMock } = buildDeps();

    await updateSwimlaneTool.handler(
      { swimlane_id: 3, name: "Done", description: "Final lane" },
      deps,
    );

    expect(updateSwimlaneMock).toHaveBeenCalledWith({
      swimlane_id: 3,
      name: "Done",
      description: "Final lane",
    });
  });
});

describe("update_swimlane — Zod validation", () => {
  it("4. .refine() rejects when only swimlane_id provided → ValidationError; updateSwimlane NOT called", async () => {
    const { deps, updateSwimlaneMock } = buildDeps();

    await expect(
      updateSwimlaneTool.handler({ swimlane_id: 3 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(updateSwimlaneMock).not.toHaveBeenCalled();
  });

  it("5. .strict() rejects unknown fields", async () => {
    const { deps } = buildDeps();

    await expect(
      updateSwimlaneTool.handler({ swimlane_id: 3, name: "OK", mystery: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. swimlane_id ≤ 0 rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      updateSwimlaneTool.handler({ swimlane_id: 0, name: "Bad" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("update_swimlane — error propagation and resolver contract", () => {
  it("7. getSwimlane NotFoundError propagated; updateSwimlane NOT called; resolver NOT invalidated", async () => {
    const { deps, updateSwimlaneMock, invalidateMock } = buildDeps({
      getSwimlaneResult: "throw-notfound",
    });

    await expect(
      updateSwimlaneTool.handler({ swimlane_id: 999, name: "Ghost" }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(updateSwimlaneMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("8. updateSwimlane KanboardApiError propagated; resolver NOT invalidated", async () => {
    const { deps, invalidateMock } = buildDeps({
      updateSwimlaneResult: "throw-api",
    });

    await expect(
      updateSwimlaneTool.handler({ swimlane_id: 3, name: "Fail" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("9. resolver.invalidate called with project_id from getSwimlane", async () => {
    const customSwimlane: Swimlane = { ...FAKE_SWIMLANE, project_id: 99 };
    const { deps, invalidateMock } = buildDeps({ getSwimlaneResult: customSwimlane });

    await updateSwimlaneTool.handler({ swimlane_id: 3, name: "Renamed" }, deps);

    expect(invalidateMock).toHaveBeenCalledWith(99);
    expect(invalidateMock).toHaveBeenCalledOnce();
  });
});
