/**
 * Unit tests for src/tools/move-swimlane.ts
 *
 * Strategy:
 * - KanboardHandler.getSwimlane and .changeSwimlanePosition mocked with vi.fn() — no HTTP.
 * - resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered:
 * 1. happy path result shape: { ok: true, swimlane_id, position }
 * 2. position < 1 rejected
 * 3. position missing rejected (required)
 * 4. swimlane_id missing rejected
 * 5. .strict() rejects unknown fields
 * 6. getSwimlane NotFoundError propagated; changeSwimlanePosition NOT called
 * 7. changeSwimlanePosition KanboardApiError propagated; resolver NOT invalidated
 * 8. resolver.invalidate called exactly once on success with getSwimlane's project_id
 * 9. happy full flow ordering: getSwimlane THEN changeSwimlanePosition THEN invalidate
 */

import { describe, it, expect, vi } from "vitest";
import { moveSwimlaneTool } from "../../../src/tools/move-swimlane.js";
import { KanboardApiError, NotFoundError, ValidationError } from "../../../src/shared/errors.js";
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
  position: 5,
  is_active: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: {
  getSwimlaneResult?: Swimlane | "throw-notfound";
  changeSwimlanePositionResult?: "throw-api";
}): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getSwimlaneMock: ReturnType<typeof vi.fn>;
  changeSwimlanePositionMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const getSwimlaneMock = vi.fn<KanboardHandler["getSwimlane"]>();
  if (overrides?.getSwimlaneResult === "throw-notfound") {
    getSwimlaneMock.mockRejectedValue(new NotFoundError("getSwimlane", "swimlane not found"));
  } else {
    getSwimlaneMock.mockResolvedValue(overrides?.getSwimlaneResult ?? FAKE_SWIMLANE);
  }

  const changeSwimlanePositionMock = vi.fn<KanboardHandler["changeSwimlanePosition"]>();
  if (overrides?.changeSwimlanePositionResult === "throw-api") {
    changeSwimlanePositionMock.mockRejectedValue(
      new KanboardApiError("changeSwimlanePosition", "changeSwimlanePosition failed"),
    );
  } else {
    changeSwimlanePositionMock.mockResolvedValue(undefined);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: {
      getSwimlane: getSwimlaneMock,
      changeSwimlanePosition: changeSwimlanePositionMock,
    } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, getSwimlaneMock, changeSwimlanePositionMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("move_swimlane — happy path", () => {
  it("1. returns { ok: true, swimlane_id, position }", async () => {
    const { deps, changeSwimlanePositionMock } = buildDeps();

    const result = await moveSwimlaneTool.handler({ swimlane_id: 5, position: 1 }, deps);

    expect(result.structuredContent).toEqual({ ok: true, swimlane_id: 5, position: 1 });
    expect(changeSwimlanePositionMock).toHaveBeenCalledWith({
      project_id: 12,
      swimlane_id: 5,
      position: 1,
    });
  });

  it("9. full flow: getSwimlane THEN changeSwimlanePosition THEN invalidate", async () => {
    const { deps, getSwimlaneMock, changeSwimlanePositionMock, invalidateMock } = buildDeps();

    await moveSwimlaneTool.handler({ swimlane_id: 5, position: 1 }, deps);

    expect(getSwimlaneMock).toHaveBeenCalledOnce();
    expect(changeSwimlanePositionMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledOnce();

    const getOrder = getSwimlaneMock.mock.invocationCallOrder[0] ?? 0;
    const changeOrder = changeSwimlanePositionMock.mock.invocationCallOrder[0] ?? 0;
    const invalidateOrder = invalidateMock.mock.invocationCallOrder[0] ?? 0;
    expect(getOrder).toBeLessThan(changeOrder);
    expect(changeOrder).toBeLessThan(invalidateOrder);
  });
});

describe("move_swimlane — Zod validation", () => {
  it("2. position < 1 rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      moveSwimlaneTool.handler({ swimlane_id: 5, position: 0 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("3. position missing rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      moveSwimlaneTool.handler({ swimlane_id: 5 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("4. swimlane_id missing rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      moveSwimlaneTool.handler({ position: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("5. .strict() rejects unknown fields", async () => {
    const { deps } = buildDeps();

    await expect(
      moveSwimlaneTool.handler({ swimlane_id: 5, position: 1, extra: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("move_swimlane — error propagation and resolver contract", () => {
  it("6. getSwimlane NotFoundError propagated; changeSwimlanePosition NOT called", async () => {
    const { deps, changeSwimlanePositionMock } = buildDeps({
      getSwimlaneResult: "throw-notfound",
    });

    await expect(
      moveSwimlaneTool.handler({ swimlane_id: 999, position: 1 }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(changeSwimlanePositionMock).not.toHaveBeenCalled();
  });

  it("7. changeSwimlanePosition KanboardApiError propagated; resolver NOT invalidated", async () => {
    const { deps, invalidateMock } = buildDeps({
      changeSwimlanePositionResult: "throw-api",
    });

    await expect(
      moveSwimlaneTool.handler({ swimlane_id: 5, position: 1 }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("8. resolver.invalidate called exactly once on success with getSwimlane's project_id", async () => {
    const customSwimlane: Swimlane = { ...FAKE_SWIMLANE, project_id: 77 };
    const { deps, invalidateMock } = buildDeps({ getSwimlaneResult: customSwimlane });

    await moveSwimlaneTool.handler({ swimlane_id: 5, position: 2 }, deps);

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(77);
  });
});
