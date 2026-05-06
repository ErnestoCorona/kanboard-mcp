/**
 * Unit tests for src/tools/delete-swimlane.ts
 *
 * Strategy:
 * - KanboardHandler.getSwimlane and .removeSwimlane mocked — no HTTP.
 * - resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered:
 * 1. happy path: { ok: true, swimlane_id } returned, removeSwimlane called with project_id+swimlane_id
 * 2. response text mentions swimlane id
 * 3. missing confirm rejected (Zod z.literal(true))
 * 4. confirm: false rejected (Zod)
 * 5. extra fields rejected (.strict())
 * 6. non-positive swimlane_id rejected
 * 7. getSwimlane NotFoundError propagated; removeSwimlane NOT called; resolver NOT invalidated
 * 8. removeSwimlane KanboardApiError propagated; resolver NOT invalidated
 * 9. resolver.invalidate called once on success with project_id from getSwimlane
 * 10. removeSwimlane NOT called when confirm gate fails
 */

import { describe, it, expect, vi } from "vitest";
import { deleteSwimlaneTool } from "../../../src/tools/delete-swimlane.js";
import {
  KanboardApiError,
  NotFoundError,
  ValidationError,
} from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Swimlane } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_SWIMLANE: Swimlane = {
  id: 5,
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
  removeSwimlaneResult?: "throw-api";
}): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getSwimlaneMock: ReturnType<typeof vi.fn>;
  removeSwimlaneMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const getSwimlaneMock = vi.fn<KanboardHandler["getSwimlane"]>();
  if (overrides?.getSwimlaneResult === "throw-notfound") {
    getSwimlaneMock.mockRejectedValue(new NotFoundError("getSwimlane", "swimlane not found"));
  } else {
    getSwimlaneMock.mockResolvedValue(overrides?.getSwimlaneResult ?? FAKE_SWIMLANE);
  }

  const removeSwimlaneMock = vi.fn<KanboardHandler["removeSwimlane"]>();
  if (overrides?.removeSwimlaneResult === "throw-api") {
    removeSwimlaneMock.mockRejectedValue(
      new KanboardApiError("removeSwimlane", "removeSwimlane failed"),
    );
  } else {
    removeSwimlaneMock.mockResolvedValue(undefined);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: {
      getSwimlane: getSwimlaneMock,
      removeSwimlane: removeSwimlaneMock,
    } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, getSwimlaneMock, removeSwimlaneMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("delete_swimlane — happy path", () => {
  it("1. deletes swimlane and returns { ok: true, swimlane_id }", async () => {
    const { deps, removeSwimlaneMock } = buildDeps();

    const result = await deleteSwimlaneTool.handler({ swimlane_id: 5, confirm: true }, deps);

    expect(removeSwimlaneMock).toHaveBeenCalledOnce();
    expect(removeSwimlaneMock).toHaveBeenCalledWith({ project_id: 12, swimlane_id: 5 });
    expect(result.structuredContent).toEqual({ ok: true, swimlane_id: 5 });
  });

  it("2. response text mentions swimlane id", async () => {
    const { deps } = buildDeps();

    const result = await deleteSwimlaneTool.handler({ swimlane_id: 77, confirm: true }, deps);

    expect(result.content[0].text).toContain("77");
  });
});

describe("delete_swimlane — confirm gate", () => {
  it("3. rejects when confirm is missing", async () => {
    const { deps, removeSwimlaneMock } = buildDeps();

    await expect(
      deleteSwimlaneTool.handler({ swimlane_id: 5 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeSwimlaneMock).not.toHaveBeenCalled();
  });

  it("4. rejects when confirm is false", async () => {
    const { deps, removeSwimlaneMock } = buildDeps();

    await expect(
      deleteSwimlaneTool.handler({ swimlane_id: 5, confirm: false }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeSwimlaneMock).not.toHaveBeenCalled();
  });

  it("10. removeSwimlane NOT called when confirm gate fails (string 'true' rejected)", async () => {
    const { deps, removeSwimlaneMock, getSwimlaneMock } = buildDeps();

    await expect(
      deleteSwimlaneTool.handler({ swimlane_id: 5, confirm: "true" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeSwimlaneMock).not.toHaveBeenCalled();
    expect(getSwimlaneMock).not.toHaveBeenCalled();
  });
});

describe("delete_swimlane — Zod validation", () => {
  it("5. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteSwimlaneTool.handler({ swimlane_id: 5, confirm: true, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. rejects non-positive swimlane_id", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteSwimlaneTool.handler({ swimlane_id: 0, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deleteSwimlaneTool.handler({ swimlane_id: -1, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("delete_swimlane — handler error propagation and resolver contract", () => {
  it("7. getSwimlane NotFoundError propagated; removeSwimlane NOT called; resolver NOT invalidated", async () => {
    const { deps, removeSwimlaneMock, invalidateMock } = buildDeps({
      getSwimlaneResult: "throw-notfound",
    });

    await expect(
      deleteSwimlaneTool.handler({ swimlane_id: 999, confirm: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(removeSwimlaneMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("8. removeSwimlane KanboardApiError propagated; resolver NOT invalidated", async () => {
    const { deps, invalidateMock } = buildDeps({ removeSwimlaneResult: "throw-api" });

    await expect(
      deleteSwimlaneTool.handler({ swimlane_id: 5, confirm: true }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("9. resolver.invalidate called once on success with project_id from getSwimlane", async () => {
    const customSwimlane: Swimlane = { ...FAKE_SWIMLANE, project_id: 99 };
    const { deps, invalidateMock } = buildDeps({ getSwimlaneResult: customSwimlane });

    await deleteSwimlaneTool.handler({ swimlane_id: 5, confirm: true }, deps);

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(99);
  });
});
