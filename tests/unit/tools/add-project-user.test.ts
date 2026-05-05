/**
 * Unit tests for src/tools/add-project-user.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 *
 * Cases covered:
 * - happy path: default role 'project-member' applied when role omitted
 * - happy path: explicit 'project-manager' role forwarded
 * - happy path: explicit 'project-viewer' role forwarded
 * - happy path: text response contains user id, project id, role
 * - Zod: invalid role string rejected
 * - Zod: missing project_id rejected
 * - Zod: missing user_id rejected
 * - Zod: unknown fields rejected (.strict())
 * - handler KanboardApiError propagated
 * - handler unknown error propagated
 */

import { describe, it, expect, vi } from "vitest";
import { addProjectUserTool } from "../../../src/tools/add-project-user.js";
import { KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  addProjectUserMock: ReturnType<typeof vi.fn>;
} {
  const addProjectUserMock = vi.fn<KanboardHandler["addProjectUser"]>();
  addProjectUserMock.mockResolvedValue(undefined);

  const deps = {
    handler: { addProjectUser: addProjectUserMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, addProjectUserMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("add_project_user — happy path", () => {
  it("uses default role 'project-member' when role is omitted", async () => {
    const { deps, addProjectUserMock } = buildDeps();

    const result = await addProjectUserTool.handler({ project_id: 1, user_id: 5 }, deps);

    expect(addProjectUserMock).toHaveBeenCalledWith({
      project_id: 1,
      user_id: 5,
      role: "project-member",
    });
    expect(result.structuredContent).toEqual({
      user_id: 5,
      project_id: 1,
      role: "project-member",
    });
  });

  it("forwards 'project-manager' role to handler", async () => {
    const { deps, addProjectUserMock } = buildDeps();

    await addProjectUserTool.handler({ project_id: 2, user_id: 7, role: "project-manager" }, deps);

    expect(addProjectUserMock).toHaveBeenCalledWith({
      project_id: 2,
      user_id: 7,
      role: "project-manager",
    });
  });

  it("forwards 'project-viewer' role to handler", async () => {
    const { deps } = buildDeps();

    const result = await addProjectUserTool.handler(
      { project_id: 3, user_id: 9, role: "project-viewer" },
      deps,
    );

    expect(result.structuredContent).toMatchObject({ role: "project-viewer" });
  });

  it("response text includes user id, project id, and role", async () => {
    const { deps } = buildDeps();

    const result = await addProjectUserTool.handler({ project_id: 10, user_id: 20 }, deps);

    expect(result.content[0].text).toContain("20");
    expect(result.content[0].text).toContain("10");
    expect(result.content[0].text).toContain("project-member");
  });
});

describe("add_project_user — Zod validation", () => {
  it("rejects invalid role string", async () => {
    const { deps, addProjectUserMock } = buildDeps();
    await expect(
      addProjectUserTool.handler({ project_id: 1, user_id: 2, role: "owner" as "project-member" }, deps),
    ).rejects.toThrow();
    expect(addProjectUserMock).not.toHaveBeenCalled();
  });

  it("rejects missing project_id", async () => {
    const { deps } = buildDeps();
    await expect(addProjectUserTool.handler({ user_id: 1 }, deps)).rejects.toThrow();
  });

  it("rejects missing user_id", async () => {
    const { deps } = buildDeps();
    await expect(addProjectUserTool.handler({ project_id: 1 }, deps)).rejects.toThrow();
  });

  it("rejects unknown fields (.strict())", async () => {
    const { deps } = buildDeps();
    await expect(
      addProjectUserTool.handler({ project_id: 1, user_id: 2, extra: true }, deps),
    ).rejects.toThrow();
  });
});

describe("add_project_user — handler error propagation", () => {
  it("propagates KanboardApiError from handler", async () => {
    const addProjectUserMock = vi.fn<KanboardHandler["addProjectUser"]>();
    addProjectUserMock.mockRejectedValue(
      new KanboardApiError("addProjectUser", "addProjectUser failed"),
    );
    const deps = {
      handler: { addProjectUser: addProjectUserMock } as unknown as KanboardHandler,
      resolvers: {} as unknown as Resolvers,
    };

    await expect(
      addProjectUserTool.handler({ project_id: 1, user_id: 2 }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("propagates unknown errors", async () => {
    const addProjectUserMock = vi.fn<KanboardHandler["addProjectUser"]>();
    addProjectUserMock.mockRejectedValue(new ReferenceError("boom"));
    const deps = {
      handler: { addProjectUser: addProjectUserMock } as unknown as KanboardHandler,
      resolvers: {} as unknown as Resolvers,
    };

    await expect(
      addProjectUserTool.handler({ project_id: 1, user_id: 2 }, deps),
    ).rejects.toBeInstanceOf(ReferenceError);
  });
});
