/**
 * Unit tests for src/tools/update-comment.ts
 *
 * Strategy:
 * - KanboardHandler.updateComment mocked with vi.fn() — no HTTP.
 * - Verifies the tool forwards `comment_id` to the handler. The handler is
 *   responsible for the wire `id` remap (kept opaque to the tool layer).
 *
 * Cases covered:
 * 1. happy path: returns { ok: true, comment_id }, handler called with comment_id+content
 * 2. response text mentions comment id
 * 3. comment_id missing rejected
 * 4. content missing rejected
 * 5. empty content rejected
 * 6. non-positive comment_id rejected
 * 7. extra fields rejected (.strict())
 * 8. NotFoundError from handler propagated
 * 9. KanboardApiError from handler propagated
 */

import { describe, it, expect, vi } from "vitest";
import { updateCommentTool } from "../../../src/tools/update-comment.js";
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

function buildDeps(overrides?: { updateCommentResult?: "throw-notfound" | "throw-api" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  updateCommentMock: ReturnType<typeof vi.fn>;
} {
  const updateCommentMock = vi.fn<KanboardHandler["updateComment"]>();

  if (overrides?.updateCommentResult === "throw-notfound") {
    updateCommentMock.mockRejectedValue(
      new NotFoundError("updateComment", "comment not found"),
    );
  } else if (overrides?.updateCommentResult === "throw-api") {
    updateCommentMock.mockRejectedValue(
      new KanboardApiError("updateComment", "updateComment failed"),
    );
  } else {
    updateCommentMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { updateComment: updateCommentMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, updateCommentMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("update_comment — happy path", () => {
  it("1. forwards comment_id+content and returns { ok: true, comment_id }", async () => {
    const { deps, updateCommentMock } = buildDeps();

    const result = await updateCommentTool.handler(
      { comment_id: 42, content: "edited" },
      deps,
    );

    expect(updateCommentMock).toHaveBeenCalledOnce();
    expect(updateCommentMock).toHaveBeenCalledWith({ comment_id: 42, content: "edited" });
    expect(result.structuredContent).toEqual({ ok: true, comment_id: 42 });
  });

  it("2. response text mentions comment id", async () => {
    const { deps } = buildDeps();

    const result = await updateCommentTool.handler(
      { comment_id: 77, content: "hello" },
      deps,
    );

    expect(result.content[0].text).toContain("77");
  });
});

describe("update_comment — Zod validation", () => {
  it("3. comment_id missing rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      updateCommentTool.handler({ content: "x" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("4. content missing rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      updateCommentTool.handler({ comment_id: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("5. empty content rejected", async () => {
    const { deps, updateCommentMock } = buildDeps();

    await expect(
      updateCommentTool.handler({ comment_id: 1, content: "" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(updateCommentMock).not.toHaveBeenCalled();
  });

  it("6. non-positive comment_id rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      updateCommentTool.handler({ comment_id: 0, content: "x" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateCommentTool.handler({ comment_id: -1, content: "x" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("7. extra fields rejected (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      updateCommentTool.handler(
        { comment_id: 1, content: "x", extra: true },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("update_comment — handler error propagation", () => {
  it("8. NotFoundError from handler propagated", async () => {
    const { deps } = buildDeps({ updateCommentResult: "throw-notfound" });

    await expect(
      updateCommentTool.handler({ comment_id: 999, content: "x" }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("9. KanboardApiError from handler propagated", async () => {
    const { deps } = buildDeps({ updateCommentResult: "throw-api" });

    await expect(
      updateCommentTool.handler({ comment_id: 1, content: "x" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
