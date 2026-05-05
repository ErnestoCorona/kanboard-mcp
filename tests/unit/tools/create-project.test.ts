/**
 * Unit tests for src/tools/create-project.ts
 *
 * Strategy:
 * - KanboardHandler mocked with vi.fn() — no HTTP.
 *
 * Cases covered:
 * - happy path: name only → project_id returned
 * - happy path: all optional fields forwarded
 * - undeclared optional fields NOT forwarded to handler
 * - start_date / end_date as ISO 8601 strings → converted to epoch seconds
 * - start_date / end_date as epoch numbers → passed through
 * - email valid → forwarded; invalid → ValidationError
 * - invalid ISO date string rejected (ValidationError from isoToEpoch)
 * - Zod: empty name rejected
 * - Zod: name > 255 chars rejected
 * - Zod: unknown fields rejected (.strict())
 * - Zod: missing name rejected
 * - handler KanboardApiError propagated
 * - handler unknown error propagated
 */

import { describe, it, expect, vi } from "vitest";
import { createProjectTool } from "../../../src/tools/create-project.js";
import { KanboardApiError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeps(projectId = 7): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  createProjectMock: ReturnType<typeof vi.fn>;
} {
  const createProjectMock = vi.fn<KanboardHandler["createProject"]>();
  createProjectMock.mockResolvedValue(projectId);

  const deps = {
    handler: { createProject: createProjectMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };

  return { deps, createProjectMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("create_project — happy path", () => {
  it("creates a project with name only and returns project_id", async () => {
    const { deps, createProjectMock } = buildDeps(7);

    const result = await createProjectTool.handler({ name: "New Project" }, deps);

    expect(createProjectMock).toHaveBeenCalledWith({ name: "New Project" });
    expect(result.structuredContent).toEqual({ project_id: 7 });
    expect(result.content[0].type).toBe("text");
  });

  it("passes all optional fields when provided", async () => {
    const { deps, createProjectMock } = buildDeps(8);

    await createProjectTool.handler(
      {
        name: "Project",
        description: "Desc",
        identifier: "PRJ",
        owner_id: 3,
        start_date: 1717200000,
        end_date: 1719792000,
        email: "team@example.com",
      },
      deps,
    );

    expect(createProjectMock).toHaveBeenCalledWith({
      name: "Project",
      description: "Desc",
      identifier: "PRJ",
      owner_id: 3,
      start_date: 1717200000,
      end_date: 1719792000,
      email: "team@example.com",
    });
  });

  it("does not pass undefined optional fields to handler", async () => {
    const { deps, createProjectMock } = buildDeps(9);

    await createProjectTool.handler({ name: "Minimal" }, deps);

    const callArg = createProjectMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("description");
    expect(callArg).not.toHaveProperty("identifier");
    expect(callArg).not.toHaveProperty("owner_id");
    expect(callArg).not.toHaveProperty("start_date");
    expect(callArg).not.toHaveProperty("end_date");
    expect(callArg).not.toHaveProperty("email");
  });

  it("converts ISO 8601 start_date / end_date strings to epoch seconds", async () => {
    const { deps, createProjectMock } = buildDeps(10);

    await createProjectTool.handler(
      {
        name: "Dated",
        start_date: "2026-06-01T00:00:00Z",
        end_date: "2026-07-01T00:00:00Z",
      },
      deps,
    );

    const callArg = createProjectMock.mock.calls[0]?.[0] as Record<string, unknown>;
    // 2026-06-01T00:00:00Z = 1780531200; 2026-07-01T00:00:00Z = 1783209600
    expect(callArg.start_date).toBe(Math.floor(new Date("2026-06-01T00:00:00Z").getTime() / 1000));
    expect(callArg.end_date).toBe(Math.floor(new Date("2026-07-01T00:00:00Z").getTime() / 1000));
  });
});

describe("create_project — Zod validation", () => {
  it("rejects empty name", async () => {
    const { deps, createProjectMock } = buildDeps();
    await expect(createProjectTool.handler({ name: "" }, deps)).rejects.toThrow();
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("rejects name longer than 255 characters", async () => {
    const { deps } = buildDeps();
    await expect(createProjectTool.handler({ name: "x".repeat(256) }, deps)).rejects.toThrow();
  });

  it("rejects unknown fields (.strict())", async () => {
    const { deps } = buildDeps();
    await expect(createProjectTool.handler({ name: "OK", extra: true }, deps)).rejects.toThrow();
  });

  it("rejects missing name", async () => {
    const { deps } = buildDeps();
    await expect(createProjectTool.handler({}, deps)).rejects.toThrow();
  });

  it("rejects invalid email format", async () => {
    const { deps, createProjectMock } = buildDeps();
    await expect(
      createProjectTool.handler({ name: "X", email: "not-an-email" }, deps),
    ).rejects.toThrow();
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("rejects invalid ISO 8601 start_date string", async () => {
    const { deps, createProjectMock } = buildDeps();
    await expect(
      createProjectTool.handler({ name: "X", start_date: "not-a-date" }, deps),
    ).rejects.toThrow();
    expect(createProjectMock).not.toHaveBeenCalled();
  });
});

describe("create_project — handler error propagation", () => {
  it("propagates KanboardApiError from handler", async () => {
    const createProjectMock = vi.fn<KanboardHandler["createProject"]>();
    createProjectMock.mockRejectedValue(
      new KanboardApiError("createProject", "createProject failed"),
    );
    const deps = {
      handler: { createProject: createProjectMock } as unknown as KanboardHandler,
      resolvers: {} as unknown as Resolvers,
    };

    await expect(createProjectTool.handler({ name: "Fail" }, deps)).rejects.toBeInstanceOf(
      KanboardApiError,
    );
  });

  it("propagates unknown errors", async () => {
    const createProjectMock = vi.fn<KanboardHandler["createProject"]>();
    createProjectMock.mockRejectedValue(new SyntaxError("unexpected"));
    const deps = {
      handler: { createProject: createProjectMock } as unknown as KanboardHandler,
      resolvers: {} as unknown as Resolvers,
    };

    await expect(createProjectTool.handler({ name: "Oops" }, deps)).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });
});
