/**
 * Unit tests for src/tools/update-project.ts
 *
 * Strategy:
 * - KanboardHandler.updateProject mocked with vi.fn() — no HTTP.
 *
 * Cases covered (9):
 * 1. happy path: project_id + name only → returns { ok: true, project_id }
 * 2. happy path: all fields forwarded; ISO dates converted to epoch
 * 3. .strict() rejects unknown fields
 * 4. project_id ≤ 0 rejected
 * 5. .refine() rejects when ONLY project_id provided → ValidationError
 * 6. .refine() accepts when only description provided
 * 7. invalid email rejected
 * 8. handler KanboardApiError propagated
 * 9. handler NotFoundError propagated
 */

import { describe, it, expect, vi } from "vitest";
import { updateProjectTool } from "../../../src/tools/update-project.js";
import { KanboardApiError, NotFoundError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: { result?: "throw-api" | "throw-notfound" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  updateProjectMock: ReturnType<typeof vi.fn>;
} {
  const updateProjectMock = vi.fn<KanboardHandler["updateProject"]>();

  if (overrides?.result === "throw-api") {
    updateProjectMock.mockRejectedValue(
      new KanboardApiError("updateProject", "updateProject failed"),
    );
  } else if (overrides?.result === "throw-notfound") {
    updateProjectMock.mockRejectedValue(
      new NotFoundError("updateProject", "project not found"),
    );
  } else {
    updateProjectMock.mockResolvedValue(undefined);
  }

  const deps = {
    handler: { updateProject: updateProjectMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, updateProjectMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("update_project — happy path", () => {
  it("1. updates with name only and returns { ok: true, project_id }", async () => {
    const { deps, updateProjectMock } = buildDeps();

    const result = await updateProjectTool.handler({ project_id: 12, name: "New Name" }, deps);

    expect(updateProjectMock).toHaveBeenCalledOnce();
    expect(updateProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 12, name: "New Name" }),
    );
    expect(result.structuredContent).toEqual({ ok: true, project_id: 12 });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("12");
  });

  it("2. forwards all fields; ISO dates converted to epoch integers", async () => {
    const { deps, updateProjectMock } = buildDeps();

    await updateProjectTool.handler(
      {
        project_id: 12,
        name: "Updated",
        description: "A description",
        identifier: "UPD",
        owner_id: 3,
        start_date: "2026-01-01T00:00:00.000Z",
        end_date: "2026-12-31T23:59:59.000Z",
        email: "project@example.com",
      },
      deps,
    );

    const callArg = updateProjectMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg["project_id"]).toBe(12);
    expect(callArg["name"]).toBe("Updated");
    expect(callArg["description"]).toBe("A description");
    expect(callArg["identifier"]).toBe("UPD");
    expect(callArg["owner_id"]).toBe(3);
    expect(typeof callArg["start_date"]).toBe("number");
    expect(typeof callArg["end_date"]).toBe("number");
    expect(callArg["email"]).toBe("project@example.com");
  });

  it("6. refine accepts when only description is provided", async () => {
    const { deps } = buildDeps();

    const result = await updateProjectTool.handler({ project_id: 5, description: "just a description" }, deps);
    expect(result.structuredContent).toMatchObject({ ok: true, project_id: 5 });
  });
});

describe("update_project — Zod validation", () => {
  it("3. .strict() rejects unknown fields", async () => {
    const { deps } = buildDeps();

    await expect(
      updateProjectTool.handler({ project_id: 12, name: "OK", extra_field: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("4. project_id ≤ 0 rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      updateProjectTool.handler({ project_id: 0, name: "OK" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("5. .refine() rejects when ONLY project_id is provided", async () => {
    const { deps, updateProjectMock } = buildDeps();

    await expect(
      updateProjectTool.handler({ project_id: 12 }, deps),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(updateProjectMock).not.toHaveBeenCalled();
  });

  it("7. invalid email rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      updateProjectTool.handler({ project_id: 12, email: "not-an-email" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("update_project — handler error propagation", () => {
  it("8. KanboardApiError propagated", async () => {
    const { deps } = buildDeps({ result: "throw-api" });

    await expect(
      updateProjectTool.handler({ project_id: 12, name: "Fail" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("9. NotFoundError propagated", async () => {
    const { deps } = buildDeps({ result: "throw-notfound" });

    await expect(
      updateProjectTool.handler({ project_id: 99999, name: "Ghost" }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
