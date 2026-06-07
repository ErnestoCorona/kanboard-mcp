/**
 * Unit tests for src/tools/close-task.ts
 *
 * Strategy:
 * - KanboardHandler.closeTask mocked — no HTTP.
 *
 * Cases covered:
 * 1. happy path: { ok: true, task_id } returned, closeTask called with task_id
 * 2. response text mentions task id
 * 3. works WITHOUT any confirm field (close is reversible — no confirm gate)
 * 4. extra fields rejected (.strict())
 * 5. non-positive task_id rejected
 * 6. NotFoundError from handler propagated
 * 7. KanboardApiError from handler propagated
 */

import { describe, it, expect, vi } from "vitest";
import { closeTaskTool } from "../../../src/tools/close-task.js";
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

function buildDeps(overrides?: { closeTaskResult?: "throw-notfound" | "throw-api" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  closeTaskMock: ReturnType<typeof vi.fn>;
} {
  const closeTaskMock = vi.fn<KanboardHandler["closeTask"]>();

  if (overrides?.closeTaskResult === "throw-notfound") {
    closeTaskMock.mockRejectedValue(new NotFoundError("closeTask", "task not found"));
  } else if (overrides?.closeTaskResult === "throw-api") {
    closeTaskMock.mockRejectedValue(new KanboardApiError("closeTask", "closeTask failed"));
  } else {
    closeTaskMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { closeTask: closeTaskMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, closeTaskMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("close_task — happy path", () => {
  it("1. closes task and returns { ok: true, task_id }", async () => {
    const { deps, closeTaskMock } = buildDeps();

    const result = await closeTaskTool.handler({ task_id: 42 }, deps);

    expect(closeTaskMock).toHaveBeenCalledOnce();
    expect(closeTaskMock).toHaveBeenCalledWith(42);
    expect(result.structuredContent).toEqual({ ok: true, task_id: 42 });
  });

  it("2. response text mentions task id", async () => {
    const { deps } = buildDeps();

    const result = await closeTaskTool.handler({ task_id: 77 }, deps);

    expect(result.content[0].text).toContain("77");
  });

  it("3. works WITHOUT any confirm field (reversible — no confirm gate)", async () => {
    const { deps, closeTaskMock } = buildDeps();

    const result = await closeTaskTool.handler({ task_id: 5 }, deps);

    expect(closeTaskMock).toHaveBeenCalledWith(5);
    expect(result.structuredContent).toEqual({ ok: true, task_id: 5 });
  });
});

describe("close_task — Zod validation", () => {
  it("4. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      closeTaskTool.handler({ task_id: 42, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("5. rejects non-positive task_id", async () => {
    const { deps } = buildDeps();

    await expect(
      closeTaskTool.handler({ task_id: 0 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      closeTaskTool.handler({ task_id: -1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("close_task — handler error propagation", () => {
  it("6. propagates NotFoundError from handler", async () => {
    const { deps } = buildDeps({ closeTaskResult: "throw-notfound" });

    await expect(
      closeTaskTool.handler({ task_id: 999 }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("7. propagates KanboardApiError from handler", async () => {
    const { deps } = buildDeps({ closeTaskResult: "throw-api" });

    await expect(
      closeTaskTool.handler({ task_id: 42 }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
