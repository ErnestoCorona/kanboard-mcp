/**
 * Unit tests for src/tools/delete-task-file.ts
 *
 * Strategy:
 * - KanboardHandler.removeTaskFile mocked — no HTTP.
 *
 * Cases covered:
 * 1. happy path: { ok: true, file_id } returned, removeTaskFile called
 * 2. response text mentions file id
 * 3. missing confirm rejected; no side-effects
 * 4. confirm: false rejected; no side-effects
 * 5. extra fields rejected (.strict())
 * 6. non-positive file_id rejected
 * 7. NotFoundError propagated
 * 8. KanboardApiError propagated
 */

import { describe, it, expect, vi } from "vitest";
import { deleteTaskFileTool } from "../../../src/tools/delete-task-file.js";
import {
  KanboardApiError,
  NotFoundError,
  ValidationError,
} from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

function buildDeps(overrides?: { removeTaskFileResult?: "throw-notfound" | "throw-api" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  removeTaskFileMock: ReturnType<typeof vi.fn>;
} {
  const removeTaskFileMock = vi.fn<KanboardHandler["removeTaskFile"]>();

  if (overrides?.removeTaskFileResult === "throw-notfound") {
    removeTaskFileMock.mockRejectedValue(new NotFoundError("removeTaskFile", "file not found"));
  } else if (overrides?.removeTaskFileResult === "throw-api") {
    removeTaskFileMock.mockRejectedValue(
      new KanboardApiError("removeTaskFile", "removeTaskFile failed"),
    );
  } else {
    removeTaskFileMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { removeTaskFile: removeTaskFileMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, removeTaskFileMock };
}

describe("delete_task_file — happy path", () => {
  it("1. deletes file and returns { ok: true, file_id }", async () => {
    const { deps, removeTaskFileMock } = buildDeps();

    const result = await deleteTaskFileTool.handler({ file_id: 7, confirm: true }, deps);

    expect(removeTaskFileMock).toHaveBeenCalledOnce();
    expect(removeTaskFileMock).toHaveBeenCalledWith(7);
    expect(result.structuredContent).toEqual({ ok: true, file_id: 7 });
  });

  it("2. response text mentions file id", async () => {
    const { deps } = buildDeps();

    const result = await deleteTaskFileTool.handler({ file_id: 21, confirm: true }, deps);

    expect(result.content[0].text).toContain("21");
  });
});

describe("delete_task_file — confirm gate", () => {
  it("3. rejects when confirm is missing; removeTaskFile NOT called", async () => {
    const { deps, removeTaskFileMock } = buildDeps();

    await expect(
      deleteTaskFileTool.handler({ file_id: 7 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeTaskFileMock).not.toHaveBeenCalled();
  });

  it("4. rejects when confirm is false; removeTaskFile NOT called", async () => {
    const { deps, removeTaskFileMock } = buildDeps();

    await expect(
      deleteTaskFileTool.handler({ file_id: 7, confirm: false }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(removeTaskFileMock).not.toHaveBeenCalled();
  });
});

describe("delete_task_file — Zod validation", () => {
  it("5. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteTaskFileTool.handler({ file_id: 7, confirm: true, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. rejects non-positive file_id", async () => {
    const { deps } = buildDeps();

    await expect(
      deleteTaskFileTool.handler({ file_id: 0, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      deleteTaskFileTool.handler({ file_id: -1, confirm: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("delete_task_file — handler error propagation", () => {
  it("7. propagates NotFoundError", async () => {
    const { deps } = buildDeps({ removeTaskFileResult: "throw-notfound" });

    await expect(
      deleteTaskFileTool.handler({ file_id: 999, confirm: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("8. propagates KanboardApiError", async () => {
    const { deps } = buildDeps({ removeTaskFileResult: "throw-api" });

    await expect(
      deleteTaskFileTool.handler({ file_id: 7, confirm: true }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
