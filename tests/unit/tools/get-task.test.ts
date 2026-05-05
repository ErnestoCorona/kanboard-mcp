/**
 * Unit tests for src/tools/get-task.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 * - No project context resolution needed (tool uses task_id directly).
 *
 * Cases covered:
 * - happy path: task returned by id
 * - Zod input: extra fields rejected (.strict())
 * - Zod input: task_id must be positive integer
 * - handler NotFoundError propagated
 * - handler generic error propagated
 */

import { describe, it, expect, vi } from "vitest";
import { getTaskTool } from "../../../src/tools/get-task.js";
import { NotFoundError, KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Task } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_TASK: Task = {
  id: 42,
  project_id: 12,
  title: "Fix login bug",
  description: "Users cannot login after session expires.",
  status: true,
  column_id: 3,
  swimlane_id: 1,
  owner_id: 5,
  creator_id: 5,
  category_id: null,
  color_id: "red",
  position: 2,
  priority: 1,
  score: 3,
  reference: "ISSUE-42",
  tags: ["bug", "auth"],
  date_creation: "2026-04-01T09:00:00.000Z",
  date_modification: "2026-04-27T08:00:00.000Z",
  date_due: "2026-05-01T00:00:00.000Z",
  date_started: null,
  date_moved: null,
  date_completed: null,
  url: "https://pm.example.com/?task_id=42",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: { getTaskResult?: Task | "notfound" | "apierror" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getTaskMock: ReturnType<typeof vi.fn>;
} {
  const getTaskMock = vi.fn<KanboardHandler["getTask"]>();

  if (overrides?.getTaskResult === "notfound") {
    getTaskMock.mockRejectedValue(new NotFoundError("getTask", "Task 999 not found"));
  } else if (overrides?.getTaskResult === "apierror") {
    getTaskMock.mockRejectedValue(new KanboardApiError("getTask", "API error"));
  } else {
    getTaskMock.mockResolvedValue(overrides?.getTaskResult ?? FAKE_TASK);
  }

  const deps = {
    handler: { getTask: getTaskMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, getTaskMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("get_task — happy path", () => {
  it("returns the task for a valid task_id", async () => {
    const { deps, getTaskMock } = buildDeps();

    const result = await getTaskTool.handler({ task_id: 42 }, deps);

    expect(getTaskMock).toHaveBeenCalledWith(42);
    expect(result.structuredContent).toEqual(FAKE_TASK);
  });

  it("response content is JSON string of the task", async () => {
    const { deps } = buildDeps();

    const result = await getTaskTool.handler({ task_id: 42 }, deps);

    const parsed = JSON.parse(result.content[0].text) as { id: number; title: string };
    expect(parsed.id).toBe(42);
    expect(parsed.title).toBe("Fix login bug");
  });
});

describe("get_task — Zod validation", () => {
  it("rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      getTaskTool.handler({ task_id: 42, extra: "field" }, deps),
    ).rejects.toThrow();
  });

  it("rejects non-positive task_id", async () => {
    const { deps } = buildDeps();

    await expect(getTaskTool.handler({ task_id: 0 }, deps)).rejects.toThrow();
    await expect(getTaskTool.handler({ task_id: -1 }, deps)).rejects.toThrow();
  });

  it("rejects missing task_id", async () => {
    const { deps } = buildDeps();

    await expect(getTaskTool.handler({}, deps)).rejects.toThrow();
  });
});

describe("get_task — handler error propagation", () => {
  it("propagates NotFoundError when task does not exist", async () => {
    const { deps } = buildDeps({ getTaskResult: "notfound" });

    await expect(
      getTaskTool.handler({ task_id: 999 }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("propagates generic KanboardApiError", async () => {
    const { deps } = buildDeps({ getTaskResult: "apierror" });

    await expect(
      getTaskTool.handler({ task_id: 42 }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
