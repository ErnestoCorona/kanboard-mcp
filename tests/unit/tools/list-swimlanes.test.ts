/**
 * Unit tests for src/tools/list-swimlanes.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { listSwimlanesTool } from "../../../src/tools/list-swimlanes.js";
import { KanboardApiError, ConfigError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Swimlane } from "../../../src/shared/types.js";

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

const FAKE_SWIMLANE: Swimlane = {
  id: 1,
  project_id: 5,
  name: "Default swimlane",
  description: "",
  position: 1,
  is_active: true,
};

const RESOLVED_CTX = { projectId: 5, yamlPath: null, defaults: {} };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): {
  deps: { handler: KanboardHandler; resolvers: Resolvers };
  getActiveSwimlanesMock: ReturnType<typeof vi.fn>;
} {
  const getActiveSwimlanesMock = vi.fn<KanboardHandler["getActiveSwimlanes"]>();
  const deps = {
    handler: { getActiveSwimlanes: getActiveSwimlanesMock } as unknown as KanboardHandler,
    resolvers: {} as unknown as Resolvers,
  };
  return { deps, getActiveSwimlanesMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("list_swimlanes", () => {
  let built: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    built = makeDeps();
    mockResolveProjectContext.mockReset();
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it("returns active swimlanes for the resolved project", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getActiveSwimlanesMock.mockResolvedValue([FAKE_SWIMLANE]);

    const result = await listSwimlanesTool.handler({ project_id: 5 }, built.deps);

    expect(built.getActiveSwimlanesMock).toHaveBeenCalledWith(5);
    expect(result.structuredContent).toEqual({ swimlanes: [FAKE_SWIMLANE] });
    expect(result.content[0].type).toBe("text");
  });

  it("resolves via identifier when project_id absent", async () => {
    mockResolveProjectContext.mockResolvedValue({ ...RESOLVED_CTX, projectId: 12 });
    built.getActiveSwimlanesMock.mockResolvedValue([FAKE_SWIMLANE]);

    await listSwimlanesTool.handler({ project_identifier: "SWIM" }, built.deps);

    expect(built.getActiveSwimlanesMock).toHaveBeenCalledWith(12);
  });

  it("falls back to yaml/context when both fields are omitted", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getActiveSwimlanesMock.mockResolvedValue([]);

    await listSwimlanesTool.handler({}, built.deps);
    expect(mockResolveProjectContext).toHaveBeenCalledWith(built.deps.handler, {});
  });

  it("returns multiple swimlanes", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    const lanes = [FAKE_SWIMLANE, { ...FAKE_SWIMLANE, id: 2, name: "Sprint 1" }];
    built.getActiveSwimlanesMock.mockResolvedValue(lanes);

    const result = await listSwimlanesTool.handler({ project_id: 5 }, built.deps);
    expect(result.structuredContent.swimlanes).toHaveLength(2);
  });

  it("returns empty array when no swimlanes", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getActiveSwimlanesMock.mockResolvedValue([]);

    const result = await listSwimlanesTool.handler({ project_id: 5 }, built.deps);
    expect(result.structuredContent).toEqual({ swimlanes: [] });
  });

  // ── Input validation ──────────────────────────────────────────────────

  it("rejects unknown input fields via .strict()", async () => {
    await expect(listSwimlanesTool.handler({ extra: true }, built.deps)).rejects.toThrow();
    expect(mockResolveProjectContext).not.toHaveBeenCalled();
  });

  // ── Error passthrough ─────────────────────────────────────────────────

  it("propagates ConfigError from resolveProjectContext", async () => {
    mockResolveProjectContext.mockRejectedValue(
      new ConfigError("Cannot resolve project context."),
    );
    await expect(listSwimlanesTool.handler({}, built.deps)).rejects.toThrow(ConfigError);
  });

  it("propagates KanboardApiError from getActiveSwimlanes", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getActiveSwimlanesMock.mockRejectedValue(
      new KanboardApiError("getActiveSwimlanes", "getActiveSwimlanes failed"),
    );
    await expect(listSwimlanesTool.handler({ project_id: 5 }, built.deps)).rejects.toThrow(KanboardApiError);
  });

  it("propagates unknown errors", async () => {
    mockResolveProjectContext.mockResolvedValue(RESOLVED_CTX);
    built.getActiveSwimlanesMock.mockRejectedValue(new TypeError("oops"));
    await expect(listSwimlanesTool.handler({ project_id: 5 }, built.deps)).rejects.toThrow(TypeError);
  });
});
