/**
 * Unit tests for src/tools/update-subtask.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 * - Key coverage: refine (at least one updatable field required), API error propagation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateSubtaskTool } from "../../../src/tools/update-subtask.js";
import { KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

function buildMockDeps(overrides?: { apiError?: boolean }): {
  handler: KanboardHandler;
  resolvers: Resolvers;
  updateSubtaskMock: ReturnType<typeof vi.fn>;
} {
  const updateSubtaskMock = vi.fn<KanboardHandler["updateSubtask"]>();

  if (overrides?.apiError === true) {
    updateSubtaskMock.mockRejectedValue(
      new KanboardApiError(
        "updateSubtask",
        "updateSubtask failed (Kanboard returned false — pre-validate inputs)",
      ),
    );
  } else {
    updateSubtaskMock.mockResolvedValue(undefined);
  }

  const handler = {
    updateSubtask: updateSubtaskMock,
  } as unknown as KanboardHandler;

  const resolvers = {} as unknown as Resolvers;

  return { handler, resolvers, updateSubtaskMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("update_subtask tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path — update title ──────────────────────────────────────────────

  it("updates subtask title successfully", async () => {
    const { handler, resolvers, updateSubtaskMock } = buildMockDeps();

    const result = await updateSubtaskTool.handler(
      { subtask_id: 10, task_id: 42, title: "New title" },
      { handler, resolvers },
    );

    expect(result.structuredContent).toEqual({ subtask_id: 10, task_id: 42 });
    const firstContent = result.content[0];
    expect(firstContent).toBeDefined();
    expect(firstContent?.text).toContain("10");
    expect(updateSubtaskMock).toHaveBeenCalledOnce();
    expect(updateSubtaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtask_id: 10, task_id: 42, title: "New title" }),
    );
  });

  // ── Happy path — update status only ───────────────────────────────────────

  it("updates status only (at least one field satisfied)", async () => {
    const { handler, resolvers, updateSubtaskMock } = buildMockDeps();

    await updateSubtaskTool.handler(
      { subtask_id: 1, task_id: 5, status: 2 },
      { handler, resolvers },
    );

    expect(updateSubtaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtask_id: 1, task_id: 5, status: 2 }),
    );
  });

  // ── Happy path — update user_id only ──────────────────────────────────────

  it("updates user_id only", async () => {
    const { handler, resolvers, updateSubtaskMock } = buildMockDeps();

    await updateSubtaskTool.handler(
      { subtask_id: 2, task_id: 10, user_id: 7 },
      { handler, resolvers },
    );

    expect(updateSubtaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtask_id: 2, task_id: 10, user_id: 7 }),
    );
  });

  // ── Happy path — update time fields ───────────────────────────────────────

  it("updates time_estimated only", async () => {
    const { handler, resolvers, updateSubtaskMock } = buildMockDeps();

    await updateSubtaskTool.handler(
      { subtask_id: 3, task_id: 10, time_estimated: 8 },
      { handler, resolvers },
    );

    expect(updateSubtaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ time_estimated: 8 }),
    );
  });

  it("updates time_spent only", async () => {
    const { handler, resolvers, updateSubtaskMock } = buildMockDeps();

    await updateSubtaskTool.handler(
      { subtask_id: 4, task_id: 10, time_spent: 3 },
      { handler, resolvers },
    );

    expect(updateSubtaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ time_spent: 3 }),
    );
  });

  // ── Refine: at least one updatable field required ────────────────────────

  it("throws ZodError when no updatable field provided (only subtask_id + task_id)", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      updateSubtaskTool.handler({ subtask_id: 1, task_id: 5 }, { handler, resolvers }),
    ).rejects.toThrow();
  });

  // ── Legacy 'id' rejected (renamed to subtask_id in v0.3.0) ───────────────

  it("rejects legacy 'id' field (renamed to 'subtask_id' in v0.3.0)", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      updateSubtaskTool.handler(
        { id: 1, task_id: 5, title: "Legacy" },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });

  // ── API error ─────────────────────────────────────────────────────────────

  it("propagates KanboardApiError from handler", async () => {
    const { handler, resolvers } = buildMockDeps({ apiError: true });

    await expect(
      updateSubtaskTool.handler(
        { subtask_id: 1, task_id: 5, title: "New" },
        { handler, resolvers },
      ),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  // ── Input validation ──────────────────────────────────────────────────────

  it("throws ZodError when subtask_id is missing", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      updateSubtaskTool.handler({ task_id: 5, title: "No subtask_id" }, { handler, resolvers }),
    ).rejects.toThrow();
  });

  it("throws ZodError when task_id is missing", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      updateSubtaskTool.handler(
        { subtask_id: 1, title: "No task_id" },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });

  it("throws ZodError when status is out of range (3)", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      updateSubtaskTool.handler(
        { subtask_id: 1, task_id: 5, status: 3 },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });

  it("rejects unknown extra fields (strict schema)", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      updateSubtaskTool.handler(
        { subtask_id: 1, task_id: 5, title: "Valid", extra_field: "bad" },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });
});
