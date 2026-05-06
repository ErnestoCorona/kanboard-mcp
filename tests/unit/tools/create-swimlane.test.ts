/**
 * Unit tests for src/tools/create-swimlane.ts
 *
 * Strategy:
 * - resolveProjectContext mocked via vi.mock.
 * - KanboardHandler.addSwimlane mocked with vi.fn() — no HTTP.
 * - resolvers.invalidate mocked — verified for NFR-9.
 *
 * Cases covered:
 * 1. happy path: project_id + name → swimlane_id returned, invalidate called once
 * 2. all optional fields (description) forwarded
 * 3. project resolved by project_identifier
 * 4. project resolved from .kanboard.yaml (no explicit id/identifier)
 * 5. unknown fields rejected (.strict())
 * 6. empty name rejected
 * 7. KanboardApiError from addSwimlane propagated; resolver NOT invalidated
 * 8. resolver.invalidate called exactly once on success
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSwimlaneTool } from "../../../src/tools/create-swimlane.js";
import { KanboardApiError, ValidationError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Mock resolveProjectContext
// ---------------------------------------------------------------------------

vi.mock("../../../src/tools/kanboard-context.js", () => ({
  resolveProjectContext: vi.fn(),
}));

import { resolveProjectContext } from "../../../src/tools/kanboard-context.js";
const mockResolveProjectContext = vi.mocked(resolveProjectContext);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOLVED_CTX = { projectId: 7, yamlPath: null, defaults: {} };
const YAML_CTX = { projectId: 99, yamlPath: "/repo/.kanboard.yaml", defaults: {} };

function buildDeps(overrides?: { addSwimlaneResult?: number | "throw" }): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  addSwimlaneMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
} {
  const addSwimlaneMock = vi.fn<KanboardHandler["addSwimlane"]>();

  if (overrides?.addSwimlaneResult === "throw") {
    addSwimlaneMock.mockRejectedValue(new KanboardApiError("addSwimlane", "addSwimlane failed"));
  } else {
    addSwimlaneMock.mockResolvedValue(overrides?.addSwimlaneResult ?? 42);
  }

  const invalidateMock = vi.fn<Resolvers["invalidate"]>();

  const deps = {
    handler: { addSwimlane: addSwimlaneMock } as unknown as KanboardHandler,
    resolvers: { invalidate: invalidateMock } as unknown as Resolvers,
  };

  return { deps, addSwimlaneMock, invalidateMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockResolveProjectContext.mockReset();
  mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
});

describe("create_swimlane — happy path", () => {
  it("1. project_id + name → swimlane_id returned, invalidate called once", async () => {
    const { deps, addSwimlaneMock, invalidateMock } = buildDeps({ addSwimlaneResult: 42 });

    const result = await createSwimlaneTool.handler(
      { project_id: 7, name: "Backlog" },
      deps,
    );

    expect(addSwimlaneMock).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 7, name: "Backlog" }),
    );
    expect(result.structuredContent).toEqual({ swimlane_id: 42 });
    expect(invalidateMock).toHaveBeenCalledWith(7);
    expect(invalidateMock).toHaveBeenCalledOnce();
  });

  it("2. description forwarded", async () => {
    const { deps, addSwimlaneMock } = buildDeps({ addSwimlaneResult: 10 });

    await createSwimlaneTool.handler(
      { project_id: 7, name: "Done", description: "Final lane" },
      deps,
    );

    expect(addSwimlaneMock).toHaveBeenCalledWith({
      project_id: 7,
      name: "Done",
      description: "Final lane",
    });
  });

  it("3. resolved by project_identifier", async () => {
    const { deps } = buildDeps();

    await createSwimlaneTool.handler(
      { project_identifier: "PRJ", name: "Sprint" },
      deps,
    );

    expect(mockResolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ explicitProjectIdentifier: "PRJ" }),
    );
  });

  it("4. resolved from .kanboard.yaml when neither id nor identifier supplied", async () => {
    mockResolveProjectContext.mockResolvedValue(YAML_CTX);
    const { deps, invalidateMock } = buildDeps({ addSwimlaneResult: 55 });

    const result = await createSwimlaneTool.handler({ name: "Backlog" }, deps);

    expect(result.structuredContent).toEqual({ swimlane_id: 55 });
    expect(invalidateMock).toHaveBeenCalledWith(99);
  });
});

describe("create_swimlane — Zod validation", () => {
  it("5. unknown fields rejected (.strict())", async () => {
    const { deps } = buildDeps();

    await expect(
      createSwimlaneTool.handler({ project_id: 7, name: "OK", unknown: true }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. empty name rejected", async () => {
    const { deps } = buildDeps();

    await expect(
      createSwimlaneTool.handler({ project_id: 7, name: "" }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("create_swimlane — error propagation and resolver contract", () => {
  it("7. KanboardApiError propagated; resolver NOT invalidated on error", async () => {
    const { deps, invalidateMock } = buildDeps({ addSwimlaneResult: "throw" });

    await expect(
      createSwimlaneTool.handler({ project_id: 7, name: "Fail" }, deps),
    ).rejects.toBeInstanceOf(KanboardApiError);

    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("8. resolver.invalidate called exactly once on success", async () => {
    const { deps, invalidateMock } = buildDeps({ addSwimlaneResult: 42 });

    await createSwimlaneTool.handler({ project_id: 7, name: "WIP" }, deps);

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(7);
  });
});
