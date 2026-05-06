/**
 * Unit tests for src/tools/update-task.ts
 *
 * Strategy:
 * - KanboardHandler.updateTask mocked with vi.fn().
 * - No project context needed (update uses task id directly).
 *
 * Cases covered:
 * - happy path: task updated, returns { ok: true }
 * - no updatable fields → ValidationError (Zod refine)
 * - only id provided → ValidationError
 * - Zod: extra fields rejected (.strict())
 * - Zod: id must be positive integer
 * - handler error propagated
 * - all optional fields forwarded to updateTask
 */

import { describe, it, expect, vi } from "vitest";
import { updateTaskTool } from "../../../src/tools/update-task.js";
import { KanboardApiError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { UpdateTaskInput as HandlerUpdateTaskInput } from "../../../src/handler/kanboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: { updateTaskResult?: "throw" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  updateTaskMock: ReturnType<typeof vi.fn>;
} {
  const updateTaskMock = vi.fn<KanboardHandler["updateTask"]>();

  if (overrides?.updateTaskResult === "throw") {
    updateTaskMock.mockRejectedValue(new KanboardApiError("updateTask", "updateTask failed"));
  } else {
    updateTaskMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { updateTask: updateTaskMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, updateTaskMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("update_task — happy path", () => {
  it("updates a task and returns { ok: true }", async () => {
    const { deps, updateTaskMock } = buildDeps();

    const result = await updateTaskTool.handler({ task_id: 42, title: "Updated title" }, deps);

    expect(updateTaskMock).toHaveBeenCalledOnce();
    expect(result.structuredContent).toMatchObject({ ok: true, task_id: 42 });
  });

  it("forwards all optional fields to updateTask", async () => {
    const { deps, updateTaskMock } = buildDeps();

    await updateTaskTool.handler(
      {
        task_id: 42,
        title: "New title",
        description: "New desc",
        color_id: "green",
        owner_id: 7,
        creator_id: 3,
        date_due: "2026-06-01T00:00:00.000Z",
        category_id: 2,
        score: 8,
        priority: 3,
        reference: "PR-42",
        tags: ["refactor"],
        date_started: "2026-05-01T08:00:00.000Z",
      },
      deps,
    );

    const callArgs = updateTaskMock.mock.calls[0]?.[0] as HandlerUpdateTaskInput | undefined;
    expect(callArgs?.task_id).toBe(42);
    expect(callArgs?.title).toBe("New title");
    expect(callArgs?.tags).toEqual(["refactor"]);
    expect(callArgs?.score).toBe(8);
  });

  it("content text mentions task id", async () => {
    const { deps } = buildDeps();

    const result = await updateTaskTool.handler({ task_id: 77, description: "Updated" }, deps);

    expect(result.content[0].text).toContain("77");
  });
});

describe("update_task — Zod validation", () => {
  it("rejects when only task_id is provided (no updatable fields)", async () => {
    const { deps } = buildDeps();

    await expect(updateTaskTool.handler({ task_id: 42 }, deps)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects legacy 'id' field (renamed to 'task_id' in v0.3.0)", async () => {
    const { deps } = buildDeps();

    await expect(
      updateTaskTool.handler({ id: 42, title: "Updated title" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty input (no task_id, no fields)", async () => {
    const { deps } = buildDeps();

    await expect(updateTaskTool.handler({}, deps)).rejects.toThrow();
  });

  it("rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      updateTaskTool.handler({ task_id: 42, title: "Valid", column_id: 3 }, deps),
    ).rejects.toThrow();
  });

  it("rejects non-positive task_id", async () => {
    const { deps } = buildDeps();

    await expect(updateTaskTool.handler({ task_id: 0, title: "X" }, deps)).rejects.toThrow();
    await expect(updateTaskTool.handler({ task_id: -1, title: "X" }, deps)).rejects.toThrow();
  });

  it("rejects empty title (min 1)", async () => {
    const { deps } = buildDeps();

    await expect(updateTaskTool.handler({ task_id: 42, title: "" }, deps)).rejects.toThrow();
  });
});

describe("update_task — handler error propagation", () => {
  it("propagates KanboardApiError from updateTask", async () => {
    const { deps } = buildDeps({ updateTaskResult: "throw" });

    await expect(
      updateTaskTool.handler({ task_id: 42, title: "Update" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});

describe("update_task — date ISO→epoch conversion", () => {
  it("converts ISO 8601 date_due string to epoch seconds before calling handler", async () => {
    const { deps, updateTaskMock } = buildDeps();
    const isoDate = "2026-06-01T00:00:00.000Z";
    const expectedEpoch = Math.floor(new Date(isoDate).getTime() / 1000);

    await updateTaskTool.handler({ task_id: 42, date_due: isoDate }, deps);

    const callArgs = updateTaskMock.mock.calls[0]?.[0] as HandlerUpdateTaskInput | undefined;
    expect(callArgs?.date_due).toBe(expectedEpoch);
    expect(typeof callArgs?.date_due).toBe("number");
  });

  it("converts ISO 8601 date_started string to epoch seconds before calling handler", async () => {
    const { deps, updateTaskMock } = buildDeps();
    const isoDate = "2026-05-01T08:00:00.000Z";
    const expectedEpoch = Math.floor(new Date(isoDate).getTime() / 1000);

    await updateTaskTool.handler({ task_id: 42, date_started: isoDate }, deps);

    const callArgs = updateTaskMock.mock.calls[0]?.[0] as HandlerUpdateTaskInput | undefined;
    expect(callArgs?.date_started).toBe(expectedEpoch);
    expect(typeof callArgs?.date_started).toBe("number");
  });

  it("passes epoch number date_due through unchanged", async () => {
    const { deps, updateTaskMock } = buildDeps();
    const epochSeconds = 1780185600;

    await updateTaskTool.handler({ task_id: 42, date_due: epochSeconds }, deps);

    const callArgs = updateTaskMock.mock.calls[0]?.[0] as HandlerUpdateTaskInput | undefined;
    expect(callArgs?.date_due).toBe(epochSeconds);
  });

  it("passes epoch number date_started through unchanged", async () => {
    const { deps, updateTaskMock } = buildDeps();
    const epochSeconds = 1746086400;

    await updateTaskTool.handler({ task_id: 42, date_started: epochSeconds }, deps);

    const callArgs = updateTaskMock.mock.calls[0]?.[0] as HandlerUpdateTaskInput | undefined;
    expect(callArgs?.date_started).toBe(epochSeconds);
  });

  it("throws ValidationError for invalid date_due string", async () => {
    const { deps } = buildDeps();

    await expect(
      updateTaskTool.handler({ task_id: 42, date_due: "not-a-date" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for invalid date_started string", async () => {
    const { deps } = buildDeps();

    await expect(
      updateTaskTool.handler({ task_id: 42, date_started: "garbage-date" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
