/**
 * Unit tests for src/tools/list-subtasks.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 * - Covers: happy path, empty list, API error propagation, Zod validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { listSubtasksTool } from "../../../src/tools/list-subtasks.js";
import { KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Subtask } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_SUBTASKS: Subtask[] = [
  {
    id: 1,
    task_id: 42,
    title: "Write tests",
    status: 0,
    time_estimated: 2,
    time_spent: 0,
    user_id: null,
  },
  {
    id: 2,
    task_id: 42,
    title: "Implement feature",
    status: 1,
    time_estimated: 4,
    time_spent: 1,
    user_id: 7,
  },
];

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

function buildMockDeps(overrides?: { subtasks?: Subtask[] | "api-error" }): {
  handler: KanboardHandler;
  resolvers: Resolvers;
  getAllSubtasksMock: ReturnType<typeof vi.fn>;
} {
  const getAllSubtasksMock = vi.fn<KanboardHandler["getAllSubtasks"]>();

  if (overrides?.subtasks === "api-error") {
    getAllSubtasksMock.mockRejectedValue(
      new KanboardApiError("getAllSubtasks", "getAllSubtasks failed (Kanboard returned false)"),
    );
  } else {
    getAllSubtasksMock.mockResolvedValue(overrides?.subtasks ?? FAKE_SUBTASKS);
  }

  const handler = {
    getAllSubtasks: getAllSubtasksMock,
  } as unknown as KanboardHandler;

  const resolvers = {} as unknown as Resolvers;

  return { handler, resolvers, getAllSubtasksMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("list_subtasks tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("returns subtasks array for a valid task_id", async () => {
    const { handler, resolvers, getAllSubtasksMock } = buildMockDeps();

    const result = await listSubtasksTool.handler({ task_id: 42 }, { handler, resolvers });

    expect(result.structuredContent).toEqual({ subtasks: FAKE_SUBTASKS, task_id: 42 });
    expect(getAllSubtasksMock).toHaveBeenCalledOnce();
    expect(getAllSubtasksMock).toHaveBeenCalledWith(42);
  });

  it("returns task_id in structuredContent", async () => {
    const { handler, resolvers } = buildMockDeps();

    const result = await listSubtasksTool.handler({ task_id: 99 }, { handler, resolvers });

    expect(result.structuredContent.task_id).toBe(99);
  });

  it("serializes subtasks as JSON in content text", async () => {
    const { handler, resolvers } = buildMockDeps();

    const result = await listSubtasksTool.handler({ task_id: 42 }, { handler, resolvers });

    const firstContent = result.content[0];
    expect(firstContent).toBeDefined();
    const parsed = JSON.parse(firstContent?.text ?? "[]") as Subtask[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe(1);
    expect(parsed[1]?.id).toBe(2);
  });

  // ── Empty list ─────────────────────────────────────────────────────────────

  it("returns empty array when task has no subtasks", async () => {
    const { handler, resolvers, getAllSubtasksMock } = buildMockDeps({ subtasks: [] });

    const result = await listSubtasksTool.handler({ task_id: 10 }, { handler, resolvers });

    expect(getAllSubtasksMock).toHaveBeenCalledWith(10);
    expect(result.structuredContent.subtasks).toEqual([]);
  });

  // ── API error propagation ─────────────────────────────────────────────────

  it("propagates KanboardApiError from handler", async () => {
    const { handler, resolvers } = buildMockDeps({ subtasks: "api-error" });

    await expect(
      listSubtasksTool.handler({ task_id: 42 }, { handler, resolvers }),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  // ── Input validation ──────────────────────────────────────────────────────

  it("throws ZodError when task_id is missing", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(listSubtasksTool.handler({}, { handler, resolvers })).rejects.toThrow();
  });

  it("throws ZodError when task_id is not a positive integer", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(listSubtasksTool.handler({ task_id: 0 }, { handler, resolvers })).rejects.toThrow();
    await expect(listSubtasksTool.handler({ task_id: -1 }, { handler, resolvers })).rejects.toThrow();
  });

  it("rejects unknown extra fields (strict schema)", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      listSubtasksTool.handler({ task_id: 1, extra: "field" }, { handler, resolvers }),
    ).rejects.toThrow();
  });
});
