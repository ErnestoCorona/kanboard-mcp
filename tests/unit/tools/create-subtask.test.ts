/**
 * Unit tests for src/tools/create-subtask.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 * - Covers: happy path, optional fields, API error, Zod validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSubtaskTool } from "../../../src/tools/create-subtask.js";
import { KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

function buildMockDeps(overrides?: { subtask_id?: number | "api-error" }): {
  handler: KanboardHandler;
  resolvers: Resolvers;
  createSubtaskMock: ReturnType<typeof vi.fn>;
} {
  const createSubtaskMock = vi.fn<KanboardHandler["createSubtask"]>();

  if (overrides?.subtask_id === "api-error") {
    createSubtaskMock.mockRejectedValue(
      new KanboardApiError(
        "createSubtask",
        "createSubtask failed (Kanboard returned false — pre-validate inputs)",
      ),
    );
  } else {
    createSubtaskMock.mockResolvedValue(overrides?.subtask_id ?? 55);
  }

  const handler = {
    createSubtask: createSubtaskMock,
  } as unknown as KanboardHandler;

  const resolvers = {} as unknown as Resolvers;

  return { handler, resolvers, createSubtaskMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("create_subtask tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path — minimal ───────────────────────────────────────────────────

  it("creates subtask with required fields only", async () => {
    const { handler, resolvers, createSubtaskMock } = buildMockDeps({ subtask_id: 55 });

    const result = await createSubtaskTool.handler(
      { task_id: 42, title: "Write tests" },
      { handler, resolvers },
    );

    expect(result.structuredContent).toEqual({ subtask_id: 55, task_id: 42 });
    const firstContent = result.content[0];
    expect(firstContent).toBeDefined();
    expect(firstContent?.text).toContain("55");
    expect(firstContent?.text).toContain("42");
    expect(createSubtaskMock).toHaveBeenCalledOnce();
    expect(createSubtaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 42, title: "Write tests" }),
    );
  });

  // ── Happy path — all optional fields ──────────────────────────────────────

  it("passes all optional fields to handler", async () => {
    const { handler, resolvers, createSubtaskMock } = buildMockDeps({ subtask_id: 100 });

    await createSubtaskTool.handler(
      {
        task_id: 10,
        title: "Full subtask",
        user_id: 3,
        time_estimated: 5,
        time_spent: 1,
        status: 1,
      },
      { handler, resolvers },
    );

    expect(createSubtaskMock).toHaveBeenCalledWith({
      task_id: 10,
      title: "Full subtask",
      user_id: 3,
      time_estimated: 5,
      time_spent: 1,
      status: 1,
    });
  });

  it("accepts status 0 (todo)", async () => {
    const { handler, resolvers, createSubtaskMock } = buildMockDeps();

    await createSubtaskTool.handler({ task_id: 1, title: "Todo", status: 0 }, { handler, resolvers });

    expect(createSubtaskMock).toHaveBeenCalledWith(expect.objectContaining({ status: 0 }));
  });

  it("accepts status 2 (done)", async () => {
    const { handler, resolvers, createSubtaskMock } = buildMockDeps();

    await createSubtaskTool.handler({ task_id: 1, title: "Done", status: 2 }, { handler, resolvers });

    expect(createSubtaskMock).toHaveBeenCalledWith(expect.objectContaining({ status: 2 }));
  });

  // ── API error ─────────────────────────────────────────────────────────────

  it("propagates KanboardApiError from handler", async () => {
    const { handler, resolvers } = buildMockDeps({ subtask_id: "api-error" });

    await expect(
      createSubtaskTool.handler({ task_id: 1, title: "Should fail" }, { handler, resolvers }),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  // ── Input validation ──────────────────────────────────────────────────────

  it("throws ZodError when task_id is missing", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      createSubtaskTool.handler({ title: "No task" }, { handler, resolvers }),
    ).rejects.toThrow();
  });

  it("throws ZodError when title is empty", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      createSubtaskTool.handler({ task_id: 1, title: "" }, { handler, resolvers }),
    ).rejects.toThrow();
  });

  it("throws ZodError when status is an invalid value", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      createSubtaskTool.handler({ task_id: 1, title: "Test", status: 3 }, { handler, resolvers }),
    ).rejects.toThrow();
  });

  it("rejects unknown extra fields (strict schema)", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      createSubtaskTool.handler(
        { task_id: 1, title: "Test", unknown_field: true },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });
});
