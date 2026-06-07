/**
 * Unit tests for src/tools/reopen-task.ts
 *
 * Strategy:
 * - KanboardHandler.openTask mocked — no HTTP.
 *
 * Cases covered:
 * 1. happy path: { ok: true, task_id } returned, openTask called with task_id
 * 2. response text mentions task id
 * 3. works WITHOUT any confirm field (reopen is reversible — no confirm gate)
 * 4. extra fields rejected (.strict())
 * 5. non-positive task_id rejected
 * 6. NotFoundError from handler propagated
 * 7. KanboardApiError from handler propagated
 */

import { describe, it, expect, vi } from "vitest";
import { reopenTaskTool } from "../../../src/tools/reopen-task.js";
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

function buildDeps(overrides?: { openTaskResult?: "throw-notfound" | "throw-api" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  openTaskMock: ReturnType<typeof vi.fn>;
} {
  const openTaskMock = vi.fn<KanboardHandler["openTask"]>();

  if (overrides?.openTaskResult === "throw-notfound") {
    openTaskMock.mockRejectedValue(new NotFoundError("openTask", "task not found"));
  } else if (overrides?.openTaskResult === "throw-api") {
    openTaskMock.mockRejectedValue(new KanboardApiError("openTask", "openTask failed"));
  } else {
    openTaskMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { openTask: openTaskMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, openTaskMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reopen_task — happy path", () => {
  it("1. reopens task and returns { ok: true, task_id }", async () => {
    const { deps, openTaskMock } = buildDeps();

    const result = await reopenTaskTool.handler({ task_id: 42 }, deps);

    expect(openTaskMock).toHaveBeenCalledOnce();
    expect(openTaskMock).toHaveBeenCalledWith(42);
    expect(result.structuredContent).toEqual({ ok: true, task_id: 42 });
  });

  it("2. response text mentions task id", async () => {
    const { deps } = buildDeps();

    const result = await reopenTaskTool.handler({ task_id: 77 }, deps);

    expect(result.content[0].text).toContain("77");
  });

  it("3. works WITHOUT any confirm field (reversible — no confirm gate)", async () => {
    const { deps, openTaskMock } = buildDeps();

    const result = await reopenTaskTool.handler({ task_id: 5 }, deps);

    expect(openTaskMock).toHaveBeenCalledWith(5);
    expect(result.structuredContent).toEqual({ ok: true, task_id: 5 });
  });
});

describe("reopen_task — Zod validation", () => {
  it("4. rejects extra fields (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      reopenTaskTool.handler({ task_id: 42, extra: 1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("5. rejects non-positive task_id", async () => {
    const { deps } = buildDeps();

    await expect(
      reopenTaskTool.handler({ task_id: 0 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      reopenTaskTool.handler({ task_id: -1 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("reopen_task — handler error propagation", () => {
  it("6. propagates NotFoundError from handler", async () => {
    const { deps } = buildDeps({ openTaskResult: "throw-notfound" });

    await expect(
      reopenTaskTool.handler({ task_id: 999 }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("7. propagates KanboardApiError from handler", async () => {
    const { deps } = buildDeps({ openTaskResult: "throw-api" });

    await expect(
      reopenTaskTool.handler({ task_id: 42 }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
