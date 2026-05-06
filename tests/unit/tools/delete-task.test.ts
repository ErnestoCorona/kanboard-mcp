/**
 * Unit tests for src/tools/delete-task.ts
 *
 * Strategy:
 * - KanboardHandler.removeTask mocked — no HTTP.
 *
 * Cases covered:
 * 1. happy path: { ok: true, task_id } returned, removeTask called with task_id
 * 2. response text mentions task id
 * 3. missing confirm rejected (Zod z.literal(true))
 * 4. confirm: false rejected (Zod)
 * 5. confirm: "true" (string) rejected (Zod)
 * 6. extra fields rejected (.strict())
 * 7. non-positive task_id rejected
 * 8. NotFoundError from handler propagated
 * 9. KanboardApiError from handler propagated
 * 10. removeTask NOT called when confirm gate fails
 */

import { describe, it, expect, vi } from "vitest";
import { deleteTaskTool } from "../../../src/tools/delete-task.js";
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

function buildDeps(overrides?: { removeTaskResult?: "throw-notfound" | "throw-api" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  removeTaskMock: ReturnType<typeof vi.fn>;
} {
  const removeTaskMock = vi.fn<KanboardHandler["removeTask"]>();

  if (overrides?.removeTaskResult === "throw-notfound") {
    removeTaskMock.mockRejectedValue(new NotFoundError("removeTask", "task not found"));
  } else if (overrides?.removeTaskResult === "throw-api") {
    removeTaskMock.mockRejectedValue(new KanboardApiError("removeTask", "removeTask failed"));
  } else {
    removeTaskMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { removeTask: removeTaskMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, removeTaskMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("delete_task — happy path", () => {
  it("1. deletes task and returns { ok: true, task_id }", async () => {
    const { deps, removeTaskMock } = buildDeps();

    const result = await deleteTaskTool.handler({ task_id: 42, confirm: true }, deps);

    expect(removeTaskMock).toHaveBeenCalledOnce();
    expect(removeTaskMock).toHaveBeenCalledWith(42);
    expect(result.structuredContent).toEqual({ ok: true, task_id: 42 });
  });

  it("2. response text mentions task id", async () => {
    const { deps } = buildDeps();

    const result = await deleteTaskTool.handler({ task_id: 77, confirm: true }, deps);

    expect(result.content[0].text).toContain("77");
  });
});

describe("delete_task — confirm gate", () => {
  it("3. rejects when confirm is missing", async () => {
    const { deps, removeTaskMock } = buildDeps();

    await expect(
      deleteTaskTool.handler({ task_id: 42 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeTaskMock).not.toHaveBeenCalled();
  });

  it("4. rejects when confirm is false", async () => {
    const { deps, removeTaskMock } = buildDeps();

    await expect(
      deleteTaskTool.handler({ task_id: 42, confirm: false }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeTaskMock).not.toHaveBeenCalled();
  });

  it("5. rejects when confirm is the string 'true'", async () => {
    const { deps, removeTaskMock } = buildDeps();

    await expect(
      deleteTaskTool.handler({ task_id: 42, confirm: "true" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeTaskMock).not.toHaveBeenCalled();
  });
});

describe("delete_task — Zod validation", () => {
  it("6. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteTaskTool.handler({ task_id: 42, confirm: true, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("7. rejects non-positive task_id", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteTaskTool.handler({ task_id: 0, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deleteTaskTool.handler({ task_id: -1, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("delete_task — handler error propagation", () => {
  it("8. propagates NotFoundError from handler", async () => {
    const { deps } = buildDeps({ removeTaskResult: "throw-notfound" });

    await expect(
      deleteTaskTool.handler({ task_id: 999, confirm: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("9. propagates KanboardApiError from handler", async () => {
    const { deps } = buildDeps({ removeTaskResult: "throw-api" });

    await expect(
      deleteTaskTool.handler({ task_id: 42, confirm: true }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
