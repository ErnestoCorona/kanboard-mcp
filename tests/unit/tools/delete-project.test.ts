/**
 * Unit tests for src/tools/delete-project.ts
 *
 * Strategy:
 * - KanboardHandler.removeProject mocked — no HTTP.
 * - Resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered:
 * 1. happy path: { ok: true, project_id } returned, removeProject called
 * 2. resolvers.invalidate called once with project_id on success
 * 3. response text mentions project id
 * 4. missing confirm rejected; removeProject NOT called; invalidate NOT called
 * 5. confirm: false rejected; no side-effects
 * 6. extra fields rejected (.strict())
 * 7. non-positive project_id rejected
 * 8. NotFoundError from handler propagated; invalidate NOT called
 * 9. KanboardApiError from handler propagated; invalidate NOT called
 * 10. ordering: removeProject THEN invalidate
 */

import { describe, it, expect, vi } from "vitest";
import { deleteProjectTool } from "../../../src/tools/delete-project.js";
import {
  KanboardApiError,
  NotFoundError,
  ValidationError,
} from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: {
  removeProjectResult?: "throw-notfound" | "throw-api";
}): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  removeProjectMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const removeProjectMock = vi.fn<KanboardHandler["removeProject"]>();

  if (overrides?.removeProjectResult === "throw-notfound") {
    removeProjectMock.mockRejectedValue(new NotFoundError("removeProject", "project not found"));
  } else if (overrides?.removeProjectResult === "throw-api") {
    removeProjectMock.mockRejectedValue(
      new KanboardApiError("removeProject", "removeProject failed"),
    );
  } else {
    removeProjectMock.mockResolvedValue(undefined);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: { removeProject: removeProjectMock } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, removeProjectMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("delete_project — happy path", () => {
  it("1. deletes project and returns { ok: true, project_id }", async () => {
    const { deps, removeProjectMock } = buildDeps();

    const result = await deleteProjectTool.handler({ project_id: 12, confirm: true }, deps);

    expect(removeProjectMock).toHaveBeenCalledOnce();
    expect(removeProjectMock).toHaveBeenCalledWith(12);
    expect(result.structuredContent).toEqual({ ok: true, project_id: 12 });
  });

  it("2. invalidates resolver cache exactly once with project_id on success", async () => {
    const { deps, invalidateMock } = buildDeps();

    await deleteProjectTool.handler({ project_id: 77, confirm: true }, deps);

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(77);
  });

  it("3. response text mentions project id", async () => {
    const { deps } = buildDeps();

    const result = await deleteProjectTool.handler({ project_id: 33, confirm: true }, deps);

    expect(result.content[0].text).toContain("33");
  });

  it("10. ordering: removeProject THEN invalidate", async () => {
    const { deps, removeProjectMock, invalidateMock } = buildDeps();

    await deleteProjectTool.handler({ project_id: 5, confirm: true }, deps);

    const removeOrder = removeProjectMock.mock.invocationCallOrder[0] ?? 0;
    const invalidateOrder = invalidateMock.mock.invocationCallOrder[0] ?? 0;
    expect(removeOrder).toBeLessThan(invalidateOrder);
  });
});

describe("delete_project — confirm gate", () => {
  it("4. rejects when confirm is missing; removeProject + invalidate NOT called", async () => {
    const { deps, removeProjectMock, invalidateMock } = buildDeps();

    await expect(
      deleteProjectTool.handler({ project_id: 12 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeProjectMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("5. rejects when confirm is false; no side-effects", async () => {
    const { deps, removeProjectMock, invalidateMock } = buildDeps();

    await expect(
      deleteProjectTool.handler({ project_id: 12, confirm: false }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeProjectMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

describe("delete_project — Zod validation", () => {
  it("6. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteProjectTool.handler({ project_id: 12, confirm: true, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("7. rejects non-positive project_id", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteProjectTool.handler({ project_id: 0, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deleteProjectTool.handler({ project_id: -1, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("delete_project — handler error propagation", () => {
  it("8. propagates NotFoundError; invalidate NOT called", async () => {
    const { deps, invalidateMock } = buildDeps({ removeProjectResult: "throw-notfound" });

    await expect(
      deleteProjectTool.handler({ project_id: 999, confirm: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("9. propagates KanboardApiError; invalidate NOT called", async () => {
    const { deps, invalidateMock } = buildDeps({ removeProjectResult: "throw-api" });

    await expect(
      deleteProjectTool.handler({ project_id: 12, confirm: true }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});
