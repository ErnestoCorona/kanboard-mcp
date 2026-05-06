/**
 * Unit tests for src/tools/delete-comment.ts
 *
 * Strategy:
 * - KanboardHandler.removeComment mocked — no HTTP.
 *
 * Cases covered:
 * 1. happy path: { ok: true, comment_id } returned, removeComment called
 * 2. response text mentions comment id
 * 3. missing confirm rejected; no side-effects
 * 4. confirm: false rejected; no side-effects
 * 5. extra fields rejected (.strict())
 * 6. non-positive comment_id rejected
 * 7. NotFoundError propagated
 * 8. KanboardApiError propagated
 */

import { describe, it, expect, vi } from "vitest";
import { deleteCommentTool } from "../../../src/tools/delete-comment.js";
import {
  KanboardApiError,
  NotFoundError,
  ValidationError,
} from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

function buildDeps(overrides?: { removeCommentResult?: "throw-notfound" | "throw-api" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  removeCommentMock: ReturnType<typeof vi.fn>;
} {
  const removeCommentMock = vi.fn<KanboardHandler["removeComment"]>();

  if (overrides?.removeCommentResult === "throw-notfound") {
    removeCommentMock.mockRejectedValue(new NotFoundError("removeComment", "comment not found"));
  } else if (overrides?.removeCommentResult === "throw-api") {
    removeCommentMock.mockRejectedValue(
      new KanboardApiError("removeComment", "removeComment failed"),
    );
  } else {
    removeCommentMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { removeComment: removeCommentMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, removeCommentMock };
}

describe("delete_comment — happy path", () => {
  it("1. deletes comment and returns { ok: true, comment_id }", async () => {
    const { deps, removeCommentMock } = buildDeps();

    const result = await deleteCommentTool.handler({ comment_id: 11, confirm: true }, deps);

    expect(removeCommentMock).toHaveBeenCalledOnce();
    expect(removeCommentMock).toHaveBeenCalledWith(11);
    expect(result.structuredContent).toEqual({ ok: true, comment_id: 11 });
  });

  it("2. response text mentions comment id", async () => {
    const { deps } = buildDeps();

    const result = await deleteCommentTool.handler({ comment_id: 99, confirm: true }, deps);

    expect(result.content[0].text).toContain("99");
  });
});

describe("delete_comment — confirm gate", () => {
  it("3. rejects when confirm is missing; removeComment NOT called", async () => {
    const { deps, removeCommentMock } = buildDeps();

    await expect(
      deleteCommentTool.handler({ comment_id: 11 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeCommentMock).not.toHaveBeenCalled();
  });

  it("4. rejects when confirm is false; removeComment NOT called", async () => {
    const { deps, removeCommentMock } = buildDeps();

    await expect(
      deleteCommentTool.handler({ comment_id: 11, confirm: false }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeCommentMock).not.toHaveBeenCalled();
  });
});

describe("delete_comment — Zod validation", () => {
  it("5. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteCommentTool.handler({ comment_id: 11, confirm: true, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. rejects non-positive comment_id", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteCommentTool.handler({ comment_id: 0, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deleteCommentTool.handler({ comment_id: -1, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("delete_comment — handler error propagation", () => {
  it("7. propagates NotFoundError", async () => {
    const { deps } = buildDeps({ removeCommentResult: "throw-notfound" });

    await expect(
      deleteCommentTool.handler({ comment_id: 999, confirm: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("8. propagates KanboardApiError", async () => {
    const { deps } = buildDeps({ removeCommentResult: "throw-api" });

    await expect(
      deleteCommentTool.handler({ comment_id: 11, confirm: true }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
