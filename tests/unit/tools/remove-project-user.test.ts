/**
 * Unit tests for src/tools/remove-project-user.ts
 *
 * Strategy:
 * - KanboardHandler.removeProjectUser mocked — no HTTP.
 * - Resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered:
 * 1. happy path: { ok: true, project_id, user_id } returned;
 *    removeProjectUser called with both ids
 * 2. resolvers.invalidate called once with project_id
 * 3. response text mentions user id and project id
 * 4. ordering: removeProjectUser THEN invalidate
 * 5. missing confirm rejected; no side-effects
 * 6. confirm: false rejected; no side-effects
 * 7. missing project_id rejected
 * 8. missing user_id rejected
 * 9. extra fields rejected (.strict())
 * 10. KanboardApiError propagated; invalidate NOT called
 */

import { describe, it, expect, vi } from "vitest";
import { removeProjectUserTool } from "../../../src/tools/remove-project-user.js";
import {
  KanboardApiError,
  ValidationError,
} from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

function buildDeps(overrides?: { removeProjectUserResult?: "throw-api" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  removeProjectUserMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const removeProjectUserMock = vi.fn<KanboardHandler["removeProjectUser"]>();
  if (overrides?.removeProjectUserResult === "throw-api") {
    removeProjectUserMock.mockRejectedValue(
      new KanboardApiError("removeProjectUser", "removeProjectUser failed"),
    );
  } else {
    removeProjectUserMock.mockResolvedValue(undefined);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: { removeProjectUser: removeProjectUserMock } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, removeProjectUserMock, invalidateMock };
}

describe("remove_project_user — happy path", () => {
  it("1. unlinks user and returns { ok: true, project_id, user_id }", async () => {
    const { deps, removeProjectUserMock } = buildDeps();

    const result = await removeProjectUserTool.handler(
      { project_id: 12, user_id: 5, confirm: true },
      deps,
    );

    expect(removeProjectUserMock).toHaveBeenCalledOnce();
    expect(removeProjectUserMock).toHaveBeenCalledWith({ project_id: 12, user_id: 5 });
    expect(result.structuredContent).toEqual({
      ok: true,
      project_id: 12,
      user_id: 5,
    });
  });

  it("2. invalidates resolver cache exactly once with project_id", async () => {
    const { deps, invalidateMock } = buildDeps();

    await removeProjectUserTool.handler(
      { project_id: 77, user_id: 3, confirm: true },
      deps,
    );

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(77);
  });

  it("3. response text mentions user and project ids", async () => {
    const { deps } = buildDeps();

    const result = await removeProjectUserTool.handler(
      { project_id: 33, user_id: 9, confirm: true },
      deps,
    );

    expect(result.content[0].text).toContain("9");
    expect(result.content[0].text).toContain("33");
  });

  it("4. ordering: removeProjectUser THEN invalidate", async () => {
    const { deps, removeProjectUserMock, invalidateMock } = buildDeps();

    await removeProjectUserTool.handler(
      { project_id: 12, user_id: 5, confirm: true },
      deps,
    );

    const removeOrder = removeProjectUserMock.mock.invocationCallOrder[0] ?? 0;
    const invalidateOrder = invalidateMock.mock.invocationCallOrder[0] ?? 0;
    expect(removeOrder).toBeLessThan(invalidateOrder);
  });
});

describe("remove_project_user — confirm gate", () => {
  it("5. rejects when confirm is missing; no side-effects", async () => {
    const { deps, removeProjectUserMock, invalidateMock } = buildDeps();

    await expect(
      removeProjectUserTool.handler({ project_id: 12, user_id: 5 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeProjectUserMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("6. rejects when confirm is false; no side-effects", async () => {
    const { deps, removeProjectUserMock, invalidateMock } = buildDeps();

    await expect(
      removeProjectUserTool.handler(
        { project_id: 12, user_id: 5, confirm: false },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeProjectUserMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

describe("remove_project_user — Zod validation", () => {
  it("7. rejects missing project_id", async () => {
    const { deps } = buildDeps();

    await expect(
      removeProjectUserTool.handler({ user_id: 5, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("8. rejects missing user_id", async () => {
    const { deps } = buildDeps();

    await expect(
      removeProjectUserTool.handler({ project_id: 12, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("9. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      removeProjectUserTool.handler(
        { project_id: 12, user_id: 5, confirm: true, extra: 1 },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("remove_project_user — handler error propagation", () => {
  it("10. propagates KanboardApiError; invalidate NOT called", async () => {
    const { deps, invalidateMock } = buildDeps({ removeProjectUserResult: "throw-api" });

    await expect(
      removeProjectUserTool.handler(
        { project_id: 12, user_id: 5, confirm: true },
        deps,
      ),
    ).rejects.toBeInstanceOf(KanboardApiError);
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});
