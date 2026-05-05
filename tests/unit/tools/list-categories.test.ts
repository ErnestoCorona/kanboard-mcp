/**
 * Unit tests for src/tools/list-categories.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { listCategoriesTool } from "../../../src/tools/list-categories.js";
import { KanboardApiError, ConfigError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Category } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Module-level mock: resolveProjectContext
// ---------------------------------------------------------------------------

vi.mock("../../../src/tools/kanboard-context.js", () => ({
  resolveProjectContext: vi.fn(),
}));

import { resolveProjectContext } from "../../../src/tools/kanboard-context.js";
const mockResolveProjectContext = vi.mocked(resolveProjectContext);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_CATEGORY: Category = {
  id: 1,
  project_id: 5,
  name: "Bug",
  color_id: "red",
};

const RESOLVED_CTX = { projectId: 5, yamlPath: null, defaults: {} };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getAllCategoriesMock: ReturnType<typeof vi.fn>;
} {
  const getAllCategoriesMock = vi.fn<KanboardHandler["getAllCategories"]>();
  const deps = {
    handler: { getAllCategories: getAllCategoriesMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };
  return { deps, getAllCategoriesMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("list_categories", () => {
  let built: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    built = makeDeps();
    mockResolveProjectContext.mockReset();
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it("returns categories for the resolved project", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getAllCategoriesMock.mockResolvedValue([FAKE_CATEGORY]);

    const result = await listCategoriesTool.handler({ project_id: 5 }, built.deps);

    expect(built.getAllCategoriesMock).toHaveBeenCalledWith(5);
    expect(result.structuredContent).toEqual({ categories: [FAKE_CATEGORY] });
  });

  it("resolves via identifier when project_id absent", async () => {
    mockResolveProjectContext.mockResolvedValue({ ...RESOLVED_CTX, projectId: 9 });
    built.getAllCategoriesMock.mockResolvedValue([]);

    await listCategoriesTool.handler({ project_identifier: "CATS" }, built.deps);

    expect(built.getAllCategoriesMock).toHaveBeenCalledWith(9);
  });

  it("returns empty array when no categories", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getAllCategoriesMock.mockResolvedValue([]);

    const result = await listCategoriesTool.handler({}, built.deps);
    expect(result.structuredContent).toEqual({ categories: [] });
  });

  it("falls back to yaml/context when both fields omitted", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getAllCategoriesMock.mockResolvedValue([]);

    await listCategoriesTool.handler({}, built.deps);
    expect(mockResolveProjectContext).toHaveBeenCalledWith(built.deps.handler, {});
  });

  // ── Input validation ──────────────────────────────────────────────────

  it("rejects unknown input fields via .strict()", async () => {
    await expect(listCategoriesTool.handler({ extra: true }, built.deps)).rejects.toThrow();
    expect(mockResolveProjectContext).not.toHaveBeenCalled();
  });

  // ── Error passthrough ─────────────────────────────────────────────────

  it("propagates ConfigError from resolveProjectContext", async () => {
    mockResolveProjectContext.mockRejectedValue(
      new ConfigError("Cannot resolve project context."),
    );
    await expect(listCategoriesTool.handler({}, built.deps)).rejects.toThrow(ConfigError);
  });

  it("propagates KanboardApiError from getAllCategories", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getAllCategoriesMock.mockRejectedValue(
      new KanboardApiError("getAllCategories", "getAllCategories failed"),
    );
    await expect(listCategoriesTool.handler({ project_id: 5 }, built.deps)).rejects.toThrow(KanboardApiError);
  });

  it("propagates unknown errors", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getAllCategoriesMock.mockRejectedValue(new TypeError("bad"));
    await expect(listCategoriesTool.handler({}, built.deps)).rejects.toThrow(TypeError);
  });
});
