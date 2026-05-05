/**
 * Unit tests for src/tools/add-comment.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 * - Verifies that user_id is NEVER passed to handler.createComment (FR-16, FR-29).
 * - Verifies AuthError from getMe() cache failure propagates.
 * - Happy path returns { comment_id }.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { addCommentTool } from "../../../src/tools/add-comment.js";
import { AuthError, KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

function buildMockDeps(overrides?: { createCommentResult?: number | "auth-error" | "api-error" }): {
  handler: KanboardHandler;
  resolvers: Resolvers;
  createCommentMock: ReturnType<typeof vi.fn>;
} {
  const createCommentMock = vi.fn<KanboardHandler["createComment"]>();

  if (overrides?.createCommentResult === "auth-error") {
    createCommentMock.mockRejectedValue(
      new AuthError("getMe", "getMe() failed during initialization: invalid token"),
    );
  } else if (overrides?.createCommentResult === "api-error") {
    createCommentMock.mockRejectedValue(
      new KanboardApiError(
        "createComment",
        "createComment failed (Kanboard returned false — pre-validate inputs)",
      ),
    );
  } else {
    createCommentMock.mockResolvedValue(overrides?.createCommentResult ?? 77);
  }

  const handler = {
    createComment: createCommentMock,
  } as unknown as KanboardHandler;

  const resolvers = {} as unknown as Resolvers;

  return { handler, resolvers, createCommentMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("add_comment tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("returns comment_id on success", async () => {
    const { handler, resolvers, createCommentMock } = buildMockDeps({ createCommentResult: 77 });

    const result = await addCommentTool.handler(
      { task_id: 42, content: "This is a comment." },
      { handler, resolvers },
    );

    expect(result.structuredContent).toEqual({ comment_id: 77 });
    const firstContent = result.content[0];
    expect(firstContent).toBeDefined();
    expect(firstContent?.text).toContain("77");
    expect(firstContent?.text).toContain("42");
    expect(createCommentMock).toHaveBeenCalledOnce();
  });

  it("passes task_id, content, reference, and visibility to handler — but NOT user_id", async () => {
    const { handler, resolvers, createCommentMock } = buildMockDeps({ createCommentResult: 10 });

    await addCommentTool.handler(
      {
        task_id: 5,
        content: "Comment with extras.",
        reference: "https://example.com/issue/1",
        visibility: "app-manager",
      },
      { handler, resolvers },
    );

    expect(createCommentMock).toHaveBeenCalledOnce();
    // Verify user_id is NOT present in the call arguments (FR-16, FR-29)
    expect(createCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: 5,
        content: "Comment with extras.",
        reference: "https://example.com/issue/1",
        visibility: "app-manager",
      }),
    );
    expect(createCommentMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ user_id: expect.anything() as unknown }),
    );
  });

  it("does NOT pass user_id when no reference/visibility provided", async () => {
    const { handler, resolvers, createCommentMock } = buildMockDeps({ createCommentResult: 20 });

    await addCommentTool.handler({ task_id: 1, content: "Simple comment" }, { handler, resolvers });

    expect(createCommentMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ user_id: expect.anything() as unknown }),
    );
  });

  it("defaults visibility to 'app-user' when not provided", async () => {
    const { handler, resolvers, createCommentMock } = buildMockDeps({ createCommentResult: 30 });

    await addCommentTool.handler({ task_id: 1, content: "Hello" }, { handler, resolvers });

    expect(createCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "app-user" }),
    );
  });

  // ── AuthError propagation ─────────────────────────────────────────────────

  it("propagates AuthError when getMe() cache failed (FR-29, S7)", async () => {
    const { handler, resolvers } = buildMockDeps({ createCommentResult: "auth-error" });

    await expect(
      addCommentTool.handler({ task_id: 1, content: "Should fail" }, { handler, resolvers }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  // ── API error propagation ─────────────────────────────────────────────────

  it("propagates KanboardApiError from handler", async () => {
    const { handler, resolvers } = buildMockDeps({ createCommentResult: "api-error" });

    await expect(
      addCommentTool.handler({ task_id: 1, content: "Should also fail" }, { handler, resolvers }),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  // ── Input validation ──────────────────────────────────────────────────────

  it("throws ZodError when task_id is missing", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      addCommentTool.handler({ content: "No task_id" }, { handler, resolvers }),
    ).rejects.toThrow();
  });

  it("throws ZodError when content is empty string", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      addCommentTool.handler({ task_id: 1, content: "" }, { handler, resolvers }),
    ).rejects.toThrow();
  });

  it("rejects invalid visibility value", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      addCommentTool.handler(
        { task_id: 1, content: "Hi", visibility: "invalid-value" },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });
});
