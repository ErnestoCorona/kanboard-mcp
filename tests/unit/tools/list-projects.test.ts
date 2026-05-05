/**
 * Unit tests for src/tools/list-projects.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 * - No project context resolution needed (no project arg).
 *
 * Cases covered:
 * - happy path: all projects returned
 * - happy path: empty list returned
 * - Zod input: extra fields rejected (.strict())
 * - handler KanboardApiError propagated
 * - handler generic error propagated
 */

import { describe, it, expect, vi } from "vitest";
import { listProjectsTool } from "../../../src/tools/list-projects.js";
import { KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Project } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_PROJECT: Project = {
  id: 1,
  name: "Test Project",
  identifier: "TEST",
  description: "",
  is_active: true,
  is_public: false,
  is_private: false,
  token: "",
  owner_id: null,
  default_swimlane: "Default swimlane",
  show_default_swimlane: true,
  start_date: null,
  end_date: null,
  url: "http://kanboard/project/1",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(overrides?: { projects?: Project[] | "apierror" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getMyProjectsMock: ReturnType<typeof vi.fn>;
} {
  const getMyProjectsMock = vi.fn<KanboardHandler["getMyProjects"]>();

  if (overrides?.projects === "apierror") {
    getMyProjectsMock.mockRejectedValue(
      new KanboardApiError("getMyProjects", "getMyProjects failed"),
    );
  } else {
    getMyProjectsMock.mockResolvedValue(overrides?.projects ?? [FAKE_PROJECT]);
  }

  const deps = {
    handler: { getMyProjects: getMyProjectsMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, getMyProjectsMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("list_projects — happy path", () => {
  it("returns all projects from handler", async () => {
    const { deps, getMyProjectsMock } = buildDeps();

    const result = await listProjectsTool.handler({}, deps);

    expect(getMyProjectsMock).toHaveBeenCalledOnce();
    expect(result.structuredContent.projects).toEqual([FAKE_PROJECT]);
    expect(result.content[0].type).toBe("text");
  });

  it("returns empty array when no projects exist", async () => {
    const { deps } = buildDeps({ projects: [] });

    const result = await listProjectsTool.handler({}, deps);

    expect(result.structuredContent.projects).toHaveLength(0);
  });
});

describe("list_projects — Zod validation", () => {
  it("rejects extra fields (.strict())", async () => {
    const { deps, getMyProjectsMock } = buildDeps();

    await expect(listProjectsTool.handler({ extra: 1 }, deps)).rejects.toThrow();
    expect(getMyProjectsMock).not.toHaveBeenCalled();
  });
});

describe("list_projects — handler error propagation", () => {
  it("propagates KanboardApiError from handler", async () => {
    const { deps } = buildDeps({ projects: "apierror" });

    await expect(listProjectsTool.handler({}, deps)).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("propagates unknown errors from handler", async () => {
    const getMyProjectsMock = vi.fn<KanboardHandler["getMyProjects"]>();
    getMyProjectsMock.mockRejectedValue(new TypeError("network failure"));
    const deps = {
      handler: { getMyProjects: getMyProjectsMock } as unknown as KanboardHandler,
      resolvers: {} as unknown as Resolvers,
    };

    await expect(listProjectsTool.handler({}, deps)).rejects.toBeInstanceOf(TypeError);
  });
});
