/**
 * Unit tests for src/tools/get-project.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 *
 * Cases covered:
 * - happy path: fetch by project_id (getProjectById called)
 * - happy path: fetch by project_identifier (getProjectByIdentifier called)
 * - happy path: fetch by project_name (getProjectByName called)
 * - refine: exactly one of the three fields required
 * - refine: two fields provided → rejects
 * - Zod strict: extra fields rejected
 * - handler NotFoundError propagated
 * - handler KanboardApiError propagated
 * - handler unknown error propagated
 */

import { describe, it, expect, vi } from "vitest";
import { getProjectTool } from "../../../src/tools/get-project.js";
import { KanboardApiError, NotFoundError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Project } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_PROJECT: Project = {
  id: 42,
  name: "My Project",
  identifier: "MYPROJ",
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
  url: "http://kanboard/project/42",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getProjectByIdMock: ReturnType<typeof vi.fn>;
  getProjectByIdentifierMock: ReturnType<typeof vi.fn>;
  getProjectByNameMock: ReturnType<typeof vi.fn>;
} {
  const getProjectByIdMock = vi.fn<KanboardHandler["getProjectById"]>();
  const getProjectByIdentifierMock = vi.fn<KanboardHandler["getProjectByIdentifier"]>();
  const getProjectByNameMock = vi.fn<KanboardHandler["getProjectByName"]>();

  getProjectByIdMock.mockResolvedValue(FAKE_PROJECT);
  getProjectByIdentifierMock.mockResolvedValue(FAKE_PROJECT);
  getProjectByNameMock.mockResolvedValue(FAKE_PROJECT);

  const deps = {
    handler: {
      getProjectById: getProjectByIdMock,
      getProjectByIdentifier: getProjectByIdentifierMock,
      getProjectByName: getProjectByNameMock,
    } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, getProjectByIdMock, getProjectByIdentifierMock, getProjectByNameMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("get_project — happy path by project_id", () => {
  it("calls getProjectById with the given id", async () => {
    const { deps, getProjectByIdMock, getProjectByIdentifierMock, getProjectByNameMock } = buildDeps();

    const result = await getProjectTool.handler({ project_id: 42 }, deps);

    expect(getProjectByIdMock).toHaveBeenCalledWith(42);
    expect(getProjectByIdentifierMock).not.toHaveBeenCalled();
    expect(getProjectByNameMock).not.toHaveBeenCalled();
    expect(result.structuredContent.project).toEqual(FAKE_PROJECT);
  });
});

describe("get_project — happy path by project_identifier", () => {
  it("calls getProjectByIdentifier with the given identifier", async () => {
    const { deps, getProjectByIdMock, getProjectByIdentifierMock } = buildDeps();

    const result = await getProjectTool.handler({ project_identifier: "MYPROJ" }, deps);

    expect(getProjectByIdentifierMock).toHaveBeenCalledWith("MYPROJ");
    expect(getProjectByIdMock).not.toHaveBeenCalled();
    expect(result.structuredContent.project).toEqual(FAKE_PROJECT);
  });
});

describe("get_project — happy path by project_name", () => {
  it("calls getProjectByName with the given name", async () => {
    const { deps, getProjectByIdMock, getProjectByNameMock } = buildDeps();

    const result = await getProjectTool.handler({ project_name: "My Project" }, deps);

    expect(getProjectByNameMock).toHaveBeenCalledWith("My Project");
    expect(getProjectByIdMock).not.toHaveBeenCalled();
    expect(result.structuredContent.project).toEqual(FAKE_PROJECT);
  });
});

describe("get_project — Zod refine: exactly one field", () => {
  it("rejects empty input — no fields", async () => {
    const { deps } = buildDeps();
    await expect(getProjectTool.handler({}, deps)).rejects.toThrow("Exactly one");
  });

  it("rejects project_id + project_identifier together", async () => {
    const { deps } = buildDeps();
    await expect(
      getProjectTool.handler({ project_id: 1, project_identifier: "X" }, deps),
    ).rejects.toThrow("Exactly one");
  });

  it("rejects project_id + project_name together", async () => {
    const { deps } = buildDeps();
    await expect(
      getProjectTool.handler({ project_id: 1, project_name: "X" }, deps),
    ).rejects.toThrow("Exactly one");
  });

  it("rejects all three fields provided", async () => {
    const { deps } = buildDeps();
    await expect(
      getProjectTool.handler({ project_id: 1, project_identifier: "X", project_name: "Y" }, deps),
    ).rejects.toThrow("Exactly one");
  });

  it("rejects unknown fields (.strict())", async () => {
    const { deps } = buildDeps();
    await expect(
      getProjectTool.handler({ project_id: 1, extra: true }, deps),
    ).rejects.toThrow();
  });
});

describe("get_project — handler error propagation", () => {
  it("propagates NotFoundError from getProjectById", async () => {
    const getProjectByIdMock = vi.fn<KanboardHandler["getProjectById"]>();
    getProjectByIdMock.mockRejectedValue(
      new NotFoundError("getProjectById", "getProjectById: entity not found"),
    );
    const deps = {
      handler: { getProjectById: getProjectByIdMock } as unknown as KanboardHandler,
      resolvers: {} as unknown as Resolvers,
    };

    await expect(getProjectTool.handler({ project_id: 999 }, deps)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("propagates KanboardApiError from getProjectByName", async () => {
    const getProjectByNameMock = vi.fn<KanboardHandler["getProjectByName"]>();
    getProjectByNameMock.mockRejectedValue(
      new KanboardApiError("getProjectByName", "something failed"),
    );
    const deps = {
      handler: { getProjectByName: getProjectByNameMock } as unknown as KanboardHandler,
      resolvers: {} as unknown as Resolvers,
    };

    await expect(
      getProjectTool.handler({ project_name: "Missing" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("propagates unknown errors", async () => {
    const getProjectByIdMock = vi.fn<KanboardHandler["getProjectById"]>();
    getProjectByIdMock.mockRejectedValue(new RangeError("unexpected"));
    const deps = {
      handler: { getProjectById: getProjectByIdMock } as unknown as KanboardHandler,
      resolvers: {} as unknown as Resolvers,
    };

    await expect(getProjectTool.handler({ project_id: 1 }, deps)).rejects.toBeInstanceOf(RangeError);
  });
});
