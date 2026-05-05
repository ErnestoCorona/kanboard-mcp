/**
 * Unit tests for Resolvers (src/handler/resolvers.ts).
 *
 * Strategy: mock KanboardHandler with vi.fn() — no HTTP, no fetch.
 * Covers:
 * - resolveColumnIdByName: exact match, case-insensitive match, not found → NotFoundError
 * - resolveColumnIdByName: ambiguous (multiple title matches) → KanboardApiError listing ids
 * - Cache hit: two calls share one fetch (getColumns called once)
 * - invalidate(projectId): drops entry; next call refetches
 * - invalidateAll(): drops all entries
 * - resolveDefaultSwimlaneId: yamlDefault bypasses fetch; first active swimlane; empty → ConfigError
 * - Concurrent callers share the inflight promise (getColumns called once)
 * - Failed fetch evicts cache so next call retries (no poisoned cache)
 */

import { describe, it, expect, vi, type Mock } from "vitest";
import { Resolvers } from "../../../src/handler/resolvers.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import { ValidationError, NotFoundError, ConfigError, KanboardApiError } from "../../../src/shared/errors.js";
import { createLogger } from "../../../src/shared/logger.js";
import type { Column, Swimlane } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 12;

const COLUMNS: Column[] = [
  { id: 1, project_id: PROJECT_ID, title: "Backlog", position: 1, task_limit: 0, description: "", hide_in_dashboard: false },
  { id: 2, project_id: PROJECT_ID, title: "In Progress", position: 2, task_limit: 0, description: "", hide_in_dashboard: false },
  { id: 3, project_id: PROJECT_ID, title: "Done", position: 3, task_limit: 0, description: "", hide_in_dashboard: false },
];

const SWIMLANES: Swimlane[] = [
  { id: 10, project_id: PROJECT_ID, name: "Default swimlane", description: "", position: 1, is_active: true },
  { id: 11, project_id: PROJECT_ID, name: "Feature A", description: "", position: 2, is_active: true },
];

// ---------------------------------------------------------------------------
// Builder helper
// ---------------------------------------------------------------------------

function buildResolvers(overrides?: {
  getColumnsFn?: Mock<KanboardHandler["getColumns"]>;
  getActiveSwimlanesFn?: Mock<KanboardHandler["getActiveSwimlanes"]>;
}): {
  resolvers: Resolvers;
  getColumnsMock: Mock<KanboardHandler["getColumns"]>;
  getActiveSwimlanesMock: Mock<KanboardHandler["getActiveSwimlanes"]>;
} {
  const getColumnsMock =
    overrides?.getColumnsFn ?? vi.fn<KanboardHandler["getColumns"]>().mockResolvedValue(COLUMNS);
  const getActiveSwimlanesMock =
    overrides?.getActiveSwimlanesFn ??
    vi.fn<KanboardHandler["getActiveSwimlanes"]>().mockResolvedValue(SWIMLANES);

  const handler = {
    getColumns: getColumnsMock,
    getActiveSwimlanes: getActiveSwimlanesMock,
  } as unknown as KanboardHandler;

  const logger = createLogger({ level: "silent" });
  const resolvers = new Resolvers({ handler, logger });

  return { resolvers, getColumnsMock, getActiveSwimlanesMock };
}

// ---------------------------------------------------------------------------
// resolveColumnIdByName — happy paths
// ---------------------------------------------------------------------------

describe("resolveColumnIdByName — happy paths", () => {
  it("resolves by exact title match → returns column id", async () => {
    const { resolvers } = buildResolvers();
    const id = await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    expect(id).toBe(1);
  });

  it("resolves case-insensitively (lowercase input)", async () => {
    const { resolvers } = buildResolvers();
    const id = await resolvers.resolveColumnIdByName(PROJECT_ID, "in progress");
    expect(id).toBe(2);
  });

  it("resolves case-insensitively (UPPER input)", async () => {
    const { resolvers } = buildResolvers();
    const id = await resolvers.resolveColumnIdByName(PROJECT_ID, "DONE");
    expect(id).toBe(3);
  });

  it("resolves case-insensitively (mixed case input)", async () => {
    const { resolvers } = buildResolvers();
    const id = await resolvers.resolveColumnIdByName(PROJECT_ID, "In PROGRESS");
    expect(id).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// resolveColumnIdByName — not found
// ---------------------------------------------------------------------------

describe("resolveColumnIdByName — not found", () => {
  it("throws NotFoundError when column name not found", async () => {
    const { resolvers } = buildResolvers();
    await expect(resolvers.resolveColumnIdByName(PROJECT_ID, "Reviewing")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("not-found error is NOT a ValidationError (must use NotFoundError per FR-11)", async () => {
    const { resolvers } = buildResolvers();
    const err = await resolvers
      .resolveColumnIdByName(PROJECT_ID, "Reviewing")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err).not.toBeInstanceOf(ValidationError);
  });

  it("error message lists all valid column names", async () => {
    const { resolvers } = buildResolvers();
    const err = await resolvers
      .resolveColumnIdByName(PROJECT_ID, "Reviewing")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    const message = (err as NotFoundError).message;
    expect(message).toContain("Backlog");
    expect(message).toContain("In Progress");
    expect(message).toContain("Done");
    expect(message).toContain("Reviewing");
  });
});

// ---------------------------------------------------------------------------
// resolveColumnIdByName — ambiguous (multiple title matches)
// ---------------------------------------------------------------------------

describe("resolveColumnIdByName — ambiguous", () => {
  const AMBIGUOUS_COLUMNS: Column[] = [
    { id: 1, project_id: PROJECT_ID, title: "Backlog", position: 1, task_limit: 0, description: "", hide_in_dashboard: false },
    { id: 2, project_id: PROJECT_ID, title: "Review", position: 2, task_limit: 0, description: "", hide_in_dashboard: false },
    { id: 3, project_id: PROJECT_ID, title: "Review", position: 3, task_limit: 0, description: "", hide_in_dashboard: false },
    { id: 7, project_id: PROJECT_ID, title: "review", position: 4, task_limit: 0, description: "", hide_in_dashboard: false },
  ];

  function buildAmbiguous() {
    const getColumnsMock = vi
      .fn<KanboardHandler["getColumns"]>()
      .mockResolvedValue(AMBIGUOUS_COLUMNS);
    return buildResolvers({ getColumnsFn: getColumnsMock });
  }

  it("throws KanboardApiError when multiple columns share the same title (case-insensitive)", async () => {
    const { resolvers } = buildAmbiguous();
    const err = await resolvers
      .resolveColumnIdByName(PROJECT_ID, "Review")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KanboardApiError);
    // Must NOT be a ValidationError subclass — that's reserved for the not-found path.
    expect(err).not.toBeInstanceOf(ValidationError);
  });

  it("error message lists the matched column ids and tells caller to use column_id", async () => {
    const { resolvers } = buildAmbiguous();
    const err = await resolvers
      .resolveColumnIdByName(PROJECT_ID, "review")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KanboardApiError);
    const message = (err as KanboardApiError).message;
    expect(message).toContain("ambiguous");
    expect(message).toContain("2"); // id 2
    expect(message).toContain("3"); // id 3
    expect(message).toContain("7"); // id 7
    expect(message).toMatch(/column_id/i);
  });

  it("does NOT throw when the same name appears only once (single match path)", async () => {
    const { resolvers } = buildAmbiguous();
    const id = await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    expect(id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Column cache hit
// ---------------------------------------------------------------------------

describe("column cache", () => {
  it("two calls for same project only invoke getColumns once (cache hit)", async () => {
    const { resolvers, getColumnsMock } = buildResolvers();

    await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    await resolvers.resolveColumnIdByName(PROJECT_ID, "Done");

    expect(getColumnsMock).toHaveBeenCalledTimes(1);
    expect(getColumnsMock).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("different project ids result in separate getColumns calls", async () => {
    const OTHER_PROJECT = 99;
    const getColumnsMock = vi
      .fn<KanboardHandler["getColumns"]>()
      .mockResolvedValue(COLUMNS);

    const { resolvers } = buildResolvers({ getColumnsFn: getColumnsMock });

    await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    await resolvers.resolveColumnIdByName(OTHER_PROJECT, "Backlog");

    expect(getColumnsMock).toHaveBeenCalledTimes(2);
    expect(getColumnsMock).toHaveBeenNthCalledWith(1, PROJECT_ID);
    expect(getColumnsMock).toHaveBeenNthCalledWith(2, OTHER_PROJECT);
  });
});

// ---------------------------------------------------------------------------
// invalidate — drops entry, next call refetches
// ---------------------------------------------------------------------------

describe("invalidate(projectId)", () => {
  it("drops column cache for the project; next call refetches", async () => {
    const { resolvers, getColumnsMock } = buildResolvers();

    // First call — populates cache
    await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    expect(getColumnsMock).toHaveBeenCalledTimes(1);

    // Invalidate
    resolvers.invalidate(PROJECT_ID);

    // Second call — cache miss, refetch
    await resolvers.resolveColumnIdByName(PROJECT_ID, "Done");
    expect(getColumnsMock).toHaveBeenCalledTimes(2);
  });

  it("drops swimlane cache for the project; next call refetches", async () => {
    const { resolvers, getActiveSwimlanesMock } = buildResolvers();

    // Populate cache
    await resolvers.resolveDefaultSwimlaneId(PROJECT_ID, undefined);
    expect(getActiveSwimlanesMock).toHaveBeenCalledTimes(1);

    // Invalidate
    resolvers.invalidate(PROJECT_ID);

    // Next call refetches
    await resolvers.resolveDefaultSwimlaneId(PROJECT_ID, undefined);
    expect(getActiveSwimlanesMock).toHaveBeenCalledTimes(2);
  });

  it("only affects the specified project, not others", async () => {
    const OTHER_PROJECT = 77;
    const getColumnsMock = vi
      .fn<KanboardHandler["getColumns"]>()
      .mockResolvedValue(COLUMNS);

    const { resolvers } = buildResolvers({ getColumnsFn: getColumnsMock });

    // Populate cache for both projects
    await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    await resolvers.resolveColumnIdByName(OTHER_PROJECT, "Backlog");
    expect(getColumnsMock).toHaveBeenCalledTimes(2);

    // Invalidate only PROJECT_ID
    resolvers.invalidate(PROJECT_ID);

    // Only PROJECT_ID refetches
    await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    await resolvers.resolveColumnIdByName(OTHER_PROJECT, "Backlog");
    expect(getColumnsMock).toHaveBeenCalledTimes(3); // 1 extra for PROJECT_ID only
  });
});

// ---------------------------------------------------------------------------
// invalidateAll
// ---------------------------------------------------------------------------

describe("invalidateAll()", () => {
  it("drops all column cache entries; all refetch on next call", async () => {
    const OTHER_PROJECT = 55;
    const getColumnsMock = vi
      .fn<KanboardHandler["getColumns"]>()
      .mockResolvedValue(COLUMNS);

    const { resolvers } = buildResolvers({ getColumnsFn: getColumnsMock });

    // Populate cache for two projects
    await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    await resolvers.resolveColumnIdByName(OTHER_PROJECT, "Backlog");
    expect(getColumnsMock).toHaveBeenCalledTimes(2);

    resolvers.invalidateAll();

    // Both refetch
    await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    await resolvers.resolveColumnIdByName(OTHER_PROJECT, "Backlog");
    expect(getColumnsMock).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// resolveDefaultSwimlaneId
// ---------------------------------------------------------------------------

describe("resolveDefaultSwimlaneId", () => {
  it("yamlDefault provided → returns it immediately without fetching swimlanes", async () => {
    const { resolvers, getActiveSwimlanesMock } = buildResolvers();

    const id = await resolvers.resolveDefaultSwimlaneId(PROJECT_ID, 42);

    expect(id).toBe(42);
    expect(getActiveSwimlanesMock).not.toHaveBeenCalled();
  });

  it("no yamlDefault + active swimlanes → returns first swimlane id", async () => {
    const { resolvers } = buildResolvers();

    const id = await resolvers.resolveDefaultSwimlaneId(PROJECT_ID, undefined);

    expect(id).toBe(10); // SWIMLANES[0].id
  });

  it("no yamlDefault + empty swimlane list → throws ConfigError", async () => {
    const getActiveSwimlanesMock = vi
      .fn<KanboardHandler["getActiveSwimlanes"]>()
      .mockResolvedValue([]);

    const { resolvers } = buildResolvers({ getActiveSwimlanesFn: getActiveSwimlanesMock });

    await expect(resolvers.resolveDefaultSwimlaneId(PROJECT_ID)).rejects.toThrow(ConfigError);
  });

  it("ConfigError message mentions the project id and hints for resolution", async () => {
    const getActiveSwimlanesMock = vi
      .fn<KanboardHandler["getActiveSwimlanes"]>()
      .mockResolvedValue([]);

    const { resolvers } = buildResolvers({ getActiveSwimlanesFn: getActiveSwimlanesMock });

    const err = await resolvers
      .resolveDefaultSwimlaneId(PROJECT_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConfigError);
    const message = (err as ConfigError).message;
    expect(message).toContain(String(PROJECT_ID));
    expect(message).toContain("swimlane_id");
  });

  it("swimlane cache hit: two calls share one fetch", async () => {
    const { resolvers, getActiveSwimlanesMock } = buildResolvers();

    await resolvers.resolveDefaultSwimlaneId(PROJECT_ID);
    await resolvers.resolveDefaultSwimlaneId(PROJECT_ID);

    expect(getActiveSwimlanesMock).toHaveBeenCalledTimes(1);
  });

  it("yamlDefault=0 still bypasses fetch (explicit 0 is unusual but must be accepted as truthy presence)", async () => {
    // yamlDefault=undefined means "not provided"; yamlDefault=0 is 0 which is
    // falsy but explicitly passed. The signature uses 'undefined' as sentinel,
    // so 0 is a valid explicit override (edge case for projects with swimlane 0
    // — unlikely but we must honour the contract: if provided, return it).
    const { resolvers, getActiveSwimlanesMock } = buildResolvers();

    // Kanboard swimlane ids start at 1, so 0 is unrealistic, but the resolver
    // contract says "if yamlDefault is provided, return it without fetch".
    const id = await resolvers.resolveDefaultSwimlaneId(PROJECT_ID, 0);

    // 0 is treated as "provided" because it is !== undefined
    expect(id).toBe(0);
    expect(getActiveSwimlanesMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Concurrent callers share one inflight promise
// ---------------------------------------------------------------------------

describe("concurrency — shared inflight promise", () => {
  it("two simultaneous calls to resolveColumnIdByName fire getColumns only once", async () => {
    let resolveColumns!: (cols: Column[]) => void;
    const deferred = new Promise<Column[]>((res) => {
      resolveColumns = res;
    });

    const getColumnsMock = vi
      .fn<KanboardHandler["getColumns"]>()
      .mockReturnValue(deferred);

    const { resolvers } = buildResolvers({ getColumnsFn: getColumnsMock });

    // Fire two calls simultaneously (before deferred resolves)
    const p1 = resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    const p2 = resolvers.resolveColumnIdByName(PROJECT_ID, "Done");

    // Resolve the deferred now
    resolveColumns(COLUMNS);

    const [id1, id2] = await Promise.all([p1, p2]);
    expect(id1).toBe(1);
    expect(id2).toBe(3);

    // getColumns was called exactly once despite two concurrent callers
    expect(getColumnsMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Cache self-healing on rejection
// ---------------------------------------------------------------------------

describe("cache self-healing on rejection", () => {
  it("after getColumns rejects, cache entry is evicted so next call retries", async () => {
    const transientError = new KanboardApiError("getColumns", "transient network failure");

    const getColumnsMock = vi
      .fn<KanboardHandler["getColumns"]>()
      // First call fails, second call succeeds
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(COLUMNS);

    const { resolvers } = buildResolvers({ getColumnsFn: getColumnsMock });

    // First attempt — should reject (transient)
    await expect(resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog")).rejects.toThrow(
      KanboardApiError,
    );

    // Cache should be evicted; second attempt should succeed
    const id = await resolvers.resolveColumnIdByName(PROJECT_ID, "Backlog");
    expect(id).toBe(1);

    // getColumns was called twice (first failed, second succeeded)
    expect(getColumnsMock).toHaveBeenCalledTimes(2);
  });

  it("after getActiveSwimlanes rejects, cache entry is evicted so next call retries", async () => {
    const transientError = new KanboardApiError("getActiveSwimlanes", "transient error");

    const getActiveSwimlanesMock = vi
      .fn<KanboardHandler["getActiveSwimlanes"]>()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(SWIMLANES);

    const { resolvers } = buildResolvers({ getActiveSwimlanesFn: getActiveSwimlanesMock });

    // First attempt — rejects
    await expect(resolvers.resolveDefaultSwimlaneId(PROJECT_ID)).rejects.toThrow(
      KanboardApiError,
    );

    // Second attempt — succeeds (cache was evicted)
    const id = await resolvers.resolveDefaultSwimlaneId(PROJECT_ID);
    expect(id).toBe(10); // SWIMLANES[0].id

    expect(getActiveSwimlanesMock).toHaveBeenCalledTimes(2);
  });
});
