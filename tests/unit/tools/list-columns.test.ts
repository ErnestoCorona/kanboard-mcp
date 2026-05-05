/**
 * Unit tests for src/tools/list-columns.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { listColumnsTool } from "../../../src/tools/list-columns.js";
import { KanboardApiError, ConfigError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Column } from "../../../src/shared/types.js";

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

const FAKE_COLUMN: Column = {
  id: 1,
  project_id: 5,
  title: "Backlog",
  position: 1,
  task_limit: 0,
  description: "",
  hide_in_dashboard: false,
};

const RESOLVED_CTX = { projectId: 5, yamlPath: null, defaults: {} };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getColumnsMock: ReturnType<typeof vi.fn>;
} {
  const getColumnsMock = vi.fn<KanboardHandler["getColumns"]>();
  const deps = {
    handler: { getColumns: getColumnsMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };
  return { deps, getColumnsMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("list_columns", () => {
  let built: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    built = makeDeps();
    mockResolveProjectContext.mockReset();
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it("returns columns for resolved project via project_id", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getColumnsMock.mockResolvedValue([FAKE_COLUMN]);

    const result = await listColumnsTool.handler({ project_id: 5 }, built.deps);

    expect(built.getColumnsMock).toHaveBeenCalledWith(5);
    expect(result.structuredContent).toEqual({ columns: [FAKE_COLUMN] });
    expect(result.content[0].type).toBe("text");
  });

  it("resolves project via identifier when project_id is absent", async () => {
    mockResolveProjectContext.mockResolvedValue({ ...RESOLVED_CTX, projectId: 7 });
    built.getColumnsMock.mockResolvedValue([]);

    await listColumnsTool.handler({ project_identifier: "PROJ" }, built.deps);

    expect(built.getColumnsMock).toHaveBeenCalledWith(7);
  });

  it("calls resolveProjectContext with no explicit args when both omitted (yaml fallback)", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getColumnsMock.mockResolvedValue([FAKE_COLUMN]);

    await listColumnsTool.handler({}, built.deps);

    // Both undefined — ctxOpts built conditionally
    expect(mockResolveProjectContext).toHaveBeenCalledWith(built.deps.handler, {});
  });

  it("returns empty array when no columns", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getColumnsMock.mockResolvedValue([]);

    const result = await listColumnsTool.handler({ project_id: 5 }, built.deps);
    expect(result.structuredContent).toEqual({ columns: [] });
  });

  // ── Input validation ──────────────────────────────────────────────────

  it("rejects unknown input fields via .strict()", async () => {
    await expect(listColumnsTool.handler({ extra: true }, built.deps)).rejects.toThrow();
    expect(mockResolveProjectContext).not.toHaveBeenCalled();
  });

  // ── Error passthrough ─────────────────────────────────────────────────

  it("propagates ConfigError from resolveProjectContext", async () => {
    mockResolveProjectContext.mockRejectedValue(
      new ConfigError("Cannot resolve project context."),
    );
    await expect(listColumnsTool.handler({}, built.deps)).rejects.toThrow(ConfigError);
  });

  it("propagates KanboardApiError from getColumns", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getColumnsMock.mockRejectedValue(
      new KanboardApiError("getColumns", "getColumns failed"),
    );
    await expect(listColumnsTool.handler({ project_id: 5 }, built.deps)).rejects.toThrow(KanboardApiError);
  });

  it("propagates unknown errors", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getColumnsMock.mockRejectedValue(new RangeError("oops"));
    await expect(listColumnsTool.handler({ project_id: 5 }, built.deps)).rejects.toThrow(RangeError);
  });
});
