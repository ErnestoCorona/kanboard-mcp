/**
 * Unit tests for src/tools/delete-subtask.ts
 *
 * Strategy:
 * - KanboardHandler.removeSubtask mocked — no HTTP.
 *
 * Cases covered:
 * 1. happy path: { ok: true, subtask_id } returned, removeSubtask called
 * 2. response text mentions subtask id
 * 3. missing confirm rejected; no side-effects
 * 4. confirm: false rejected; no side-effects
 * 5. extra fields rejected (.strict())
 * 6. non-positive subtask_id rejected
 * 7. NotFoundError propagated
 * 8. KanboardApiError propagated
 */

import { describe, it, expect, vi } from "vitest";
import { deleteSubtaskTool } from "../../../src/tools/delete-subtask.js";
import {
  KanboardApiError,
  NotFoundError,
  ValidationError,
} from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

function buildDeps(overrides?: { removeSubtaskResult?: "throw-notfound" | "throw-api" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  removeSubtaskMock: ReturnType<typeof vi.fn>;
} {
  const removeSubtaskMock = vi.fn<KanboardHandler["removeSubtask"]>();

  if (overrides?.removeSubtaskResult === "throw-notfound") {
    removeSubtaskMock.mockRejectedValue(new NotFoundError("removeSubtask", "subtask not found"));
  } else if (overrides?.removeSubtaskResult === "throw-api") {
    removeSubtaskMock.mockRejectedValue(
      new KanboardApiError("removeSubtask", "removeSubtask failed"),
    );
  } else {
    removeSubtaskMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { removeSubtask: removeSubtaskMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, removeSubtaskMock };
}

describe("delete_subtask — happy path", () => {
  it("1. deletes subtask and returns { ok: true, subtask_id }", async () => {
    const { deps, removeSubtaskMock } = buildDeps();

    const result = await deleteSubtaskTool.handler({ subtask_id: 5, confirm: true }, deps);

    expect(removeSubtaskMock).toHaveBeenCalledOnce();
    expect(removeSubtaskMock).toHaveBeenCalledWith(5);
    expect(result.structuredContent).toEqual({ ok: true, subtask_id: 5 });
  });

  it("2. response text mentions subtask id", async () => {
    const { deps } = buildDeps();

    const result = await deleteSubtaskTool.handler({ subtask_id: 88, confirm: true }, deps);

    expect(result.content[0].text).toContain("88");
  });
});

describe("delete_subtask — confirm gate", () => {
  it("3. rejects when confirm is missing; removeSubtask NOT called", async () => {
    const { deps, removeSubtaskMock } = buildDeps();

    await expect(
      deleteSubtaskTool.handler({ subtask_id: 5 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeSubtaskMock).not.toHaveBeenCalled();
  });

  it("4. rejects when confirm is false; removeSubtask NOT called", async () => {
    const { deps, removeSubtaskMock } = buildDeps();

    await expect(
      deleteSubtaskTool.handler({ subtask_id: 5, confirm: false }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeSubtaskMock).not.toHaveBeenCalled();
  });
});

describe("delete_subtask — Zod validation", () => {
  it("5. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteSubtaskTool.handler({ subtask_id: 5, confirm: true, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. rejects non-positive subtask_id", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteSubtaskTool.handler({ subtask_id: 0, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deleteSubtaskTool.handler({ subtask_id: -1, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("delete_subtask — handler error propagation", () => {
  it("7. propagates NotFoundError", async () => {
    const { deps } = buildDeps({ removeSubtaskResult: "throw-notfound" });

    await expect(
      deleteSubtaskTool.handler({ subtask_id: 999, confirm: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("8. propagates KanboardApiError", async () => {
    const { deps } = buildDeps({ removeSubtaskResult: "throw-api" });

    await expect(
      deleteSubtaskTool.handler({ subtask_id: 5, confirm: true }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
