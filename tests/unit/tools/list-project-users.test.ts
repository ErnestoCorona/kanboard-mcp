/**
 * Unit tests for src/tools/list-project-users.ts
 *
 * The tool replaces the v0.2.5 list_users (admin-only). Project context is
 * resolved via resolveProjectContext (mocked here).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { listProjectUsersTool } from "../../../src/tools/list-project-users.js";
import { KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { ProjectMember } from "../../../src/shared/types.js";
import type { resolveProjectContext as resolveProjectContextFn } from "../../../src/tools/kanboard-context.js";

// ---------------------------------------------------------------------------
// Mock kanboard-context.resolveProjectContext
// ---------------------------------------------------------------------------

const mockResolveProjectContext = vi.fn<typeof resolveProjectContextFn>();

vi.mock("../../../src/tools/kanboard-context.js", () => ({
  resolveProjectContext: (
    ...args: Parameters<typeof resolveProjectContextFn>
  ): ReturnType<typeof resolveProjectContextFn> => mockResolveProjectContext(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_MEMBERS: ProjectMember[] = [
  { user_id: 1, username: "admin" },
  { user_id: 2, username: "alice" },
  { user_id: 7, username: "bob" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getProjectUsersMock: ReturnType<typeof vi.fn>;
} {
  const getProjectUsersMock = vi.fn<KanboardHandler["getProjectUsers"]>();
  const deps = {
    handler: { getProjectUsers: getProjectUsersMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };
  return { deps, getProjectUsersMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("list_project_users", () => {
  let built: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    built = makeDeps();
    mockResolveProjectContext.mockReset();
    mockResolveProjectContext.mockResolvedValue({ projectId: 12, yamlPath: null, defaults: {} });
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it("returns members from handler when project_id is explicit", async () => {
    built.getProjectUsersMock.mockResolvedValue(FAKE_MEMBERS);
    const result = await listProjectUsersTool.handler({ project_id: 12 }, built.deps);
    expect(result.structuredContent).toEqual({ users: FAKE_MEMBERS });
    expect(result.content[0]?.type).toBe("text");
    expect(built.getProjectUsersMock).toHaveBeenCalledWith(12);
  });

  it("uses resolved projectId from kanboard-context (yaml fallback)", async () => {
    mockResolveProjectContext.mockResolvedValue({ projectId: 99, yamlPath: "/repo/.kanboard.yaml", defaults: {} });
    built.getProjectUsersMock.mockResolvedValue([]);
    await listProjectUsersTool.handler({}, built.deps);
    expect(built.getProjectUsersMock).toHaveBeenCalledWith(99);
  });

  it("returns empty array when project has no members", async () => {
    built.getProjectUsersMock.mockResolvedValue([]);
    const result = await listProjectUsersTool.handler({ project_id: 12 }, built.deps);
    expect(result.structuredContent).toEqual({ users: [] });
  });

  it("forwards project_identifier to resolveProjectContext", async () => {
    built.getProjectUsersMock.mockResolvedValue(FAKE_MEMBERS);
    await listProjectUsersTool.handler({ project_identifier: "MYPROJ" }, built.deps);
    expect(mockResolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ explicitProjectIdentifier: "MYPROJ" }),
    );
  });

  // ── Input validation ──────────────────────────────────────────────────

  it("rejects unknown input fields via .strict()", async () => {
    await expect(
      listProjectUsersTool.handler({ extra: 1 }, built.deps),
    ).rejects.toThrow();
    expect(built.getProjectUsersMock).not.toHaveBeenCalled();
  });

  it("rejects negative project_id", async () => {
    await expect(
      listProjectUsersTool.handler({ project_id: -5 }, built.deps),
    ).rejects.toThrow();
  });

  it("rejects zero project_id", async () => {
    await expect(
      listProjectUsersTool.handler({ project_id: 0 }, built.deps),
    ).rejects.toThrow();
  });

  // ── Error passthrough ─────────────────────────────────────────────────

  it("propagates KanboardApiError from handler", async () => {
    const apiError = new KanboardApiError("getProjectUsers", "getProjectUsers failed");
    built.getProjectUsersMock.mockRejectedValue(apiError);
    await expect(
      listProjectUsersTool.handler({ project_id: 12 }, built.deps),
    ).rejects.toThrow(KanboardApiError);
  });

  it("propagates unknown errors from handler", async () => {
    built.getProjectUsersMock.mockRejectedValue(new TypeError("network failure"));
    await expect(
      listProjectUsersTool.handler({ project_id: 12 }, built.deps),
    ).rejects.toThrow(TypeError);
  });
});
