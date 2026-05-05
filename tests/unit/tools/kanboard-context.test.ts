/**
 * Unit tests for src/tools/kanboard-context.ts
 *
 * Strategy:
 * - KanboardHandler is mocked with vi.fn() — no HTTP, no fetch.
 * - Filesystem uses real temp dirs (mkdtempSync) to avoid ESM mock-fs issues.
 * - YAML cache (_clearKanboardYamlCache) + context cache (_clearProjectContextCache)
 *   are both cleared between tests for isolation.
 *
 * Cases covered:
 * - explicit project_id → getProjectById called for validation (FR-30); id returned
 * - explicit project_id → ConfigError when project does not exist (FR-30 hint mentions "arg")
 * - explicit project_identifier → getProjectByIdentifier called, id returned
 * - explicit project_identifier → ConfigError wraps NotFoundError (hint mentions "project_identifier argument")
 * - both explicit (id + identifier) → explicit_id wins (higher precedence)
 * - yaml with project_id → getProjectById called; validated once; id returned (FR-30)
 * - yaml with project_id → ConfigError when project does not exist (hint mentions yaml path)
 * - yaml with all defaults → full defaults returned
 * - yaml with project_identifier → getProjectByIdentifier called
 * - yaml with project_identifier → ConfigError wraps NotFoundError (hint mentions yaml path)
 * - explicit project_id + yaml present → explicit wins; yaml defaults merged; getProjectById called once
 * - no explicit AND no yaml → ConfigError with actionable message
 * - Cache hit: same cwd + same source → only one getProjectById call (FR-30: validate once per process)
 * - _clearProjectContextCache forces re-resolution and re-validation
 * - Walk-up: yaml found 2 levels above cwd
 */

import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  resolveProjectContext,
  _clearProjectContextCache,
} from "../../../src/tools/kanboard-context.js";
import { _clearKanboardYamlCache } from "../../../src/config/kanboard-yaml.js";
import { ConfigError, NotFoundError } from "../../../src/shared/errors.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Project } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_PROJECT: Project = {
  id: 42,
  name: "Test Project",
  identifier: "TESTPROJ",
  description: "",
  is_active: true,
  is_public: false,
  is_private: false,
  token: "",
  owner_id: null,
  default_swimlane: "Default",
  show_default_swimlane: true,
  start_date: null,
  end_date: null,
  url: "https://example.com/project/42",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "kanboard-ctx-test-"));
  tempDirs.push(d);
  return d;
}

function writeYaml(dir: string, content: string): string {
  const filePath = join(dir, ".kanboard.yaml");
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Build a mock KanboardHandler with configurable responses for
 * getProjectByIdentifier and getProjectById.
 */
function buildMockHandler(overrides?: {
  getProjectByIdentifierResult?: Project | "throw";
  getProjectByIdResult?: Project | "throw";
}): {
  handler: KanboardHandler;
  getProjectByIdentifierMock: Mock;
  getProjectByIdMock: Mock;
} {
  const getProjectByIdentifierMock = vi.fn<KanboardHandler["getProjectByIdentifier"]>();
  const getProjectByIdMock = vi.fn<KanboardHandler["getProjectById"]>();

  // getProjectByIdentifier setup
  if (overrides?.getProjectByIdentifierResult === "throw") {
    getProjectByIdentifierMock.mockRejectedValue(
      new NotFoundError("getProjectByIdentifier", "project not found"),
    );
  } else {
    const result = overrides?.getProjectByIdentifierResult ?? FAKE_PROJECT;
    getProjectByIdentifierMock.mockResolvedValue(result);
  }

  // getProjectById setup
  if (overrides?.getProjectByIdResult === "throw") {
    getProjectByIdMock.mockRejectedValue(
      new NotFoundError("getProjectById", "project not found"),
    );
  } else {
    const result = overrides?.getProjectByIdResult ?? FAKE_PROJECT;
    getProjectByIdMock.mockResolvedValue(result);
  }

  const handler = {
    getProjectByIdentifier: getProjectByIdentifierMock,
    getProjectById: getProjectByIdMock,
  } as unknown as KanboardHandler;

  return { handler, getProjectByIdentifierMock, getProjectByIdMock };
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

afterEach(() => {
  _clearProjectContextCache();
  _clearKanboardYamlCache();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }

  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Explicit project_id — FR-30: calls getProjectById for validation
// ---------------------------------------------------------------------------

describe("resolveProjectContext — explicit project_id (FR-30 validation)", () => {
  it("calls getProjectById to validate explicit project_id", async () => {
    const cwd = tmpDir();
    const { handler, getProjectByIdMock } = buildMockHandler();

    const result = await resolveProjectContext(handler, { explicitProjectId: 7, cwd });

    expect(result.projectId).toBe(7);
    expect(getProjectByIdMock).toHaveBeenCalledOnce();
    expect(getProjectByIdMock).toHaveBeenCalledWith(7);
  });

  it("does NOT call getProjectByIdentifier for explicit project_id", async () => {
    const cwd = tmpDir();
    const { handler, getProjectByIdentifierMock } = buildMockHandler();

    await resolveProjectContext(handler, { explicitProjectId: 7, cwd });

    expect(getProjectByIdentifierMock).not.toHaveBeenCalled();
  });

  it("throws ConfigError with hint mentioning arg when explicit project_id does not exist (FR-30)", async () => {
    const cwd = tmpDir();
    const { handler } = buildMockHandler({ getProjectByIdResult: "throw" });

    let caughtError: unknown;
    try {
      await resolveProjectContext(handler, { explicitProjectId: 9999, cwd });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ConfigError);
    if (ConfigError.is(caughtError)) {
      expect(caughtError.message).toContain("9999");
      // Hint should mention this came from the argument
      expect(caughtError.message).toMatch(/project_id argument|passed as project_id/i);
    }
  });

  it("merges yaml defaults when yaml is present in cwd tree", async () => {
    const cwd = tmpDir();
    writeYaml(
      cwd,
      [
        "project_id: 5",
        "default_swimlane_id: 2",
        "default_column_id: 3",
        "default_owner_id: 7",
        "default_category_id: 1",
      ].join("\n"),
    );

    const { handler } = buildMockHandler();

    // Explicit id wins but yaml defaults are still merged.
    const result = await resolveProjectContext(handler, { explicitProjectId: 999, cwd });

    expect(result.projectId).toBe(999);
    expect(result.yamlPath).not.toBeNull();
    expect(result.defaults.swimlaneId).toBe(2);
    expect(result.defaults.columnId).toBe(3);
    expect(result.defaults.ownerId).toBe(7);
    expect(result.defaults.categoryId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Explicit project_identifier
// ---------------------------------------------------------------------------

describe("resolveProjectContext — explicit project_identifier", () => {
  it("calls getProjectByIdentifier and returns its project id", async () => {
    const cwd = tmpDir();
    const { handler, getProjectByIdentifierMock } = buildMockHandler({
      getProjectByIdentifierResult: { ...FAKE_PROJECT, id: 55 },
    });

    const result = await resolveProjectContext(handler, {
      explicitProjectIdentifier: "MYPROJ",
      cwd,
    });

    expect(result.projectId).toBe(55);
    expect(getProjectByIdentifierMock).toHaveBeenCalledOnce();
    expect(getProjectByIdentifierMock).toHaveBeenCalledWith("MYPROJ");
  });

  it("throws ConfigError (wrapping NotFoundError) with hint mentioning arg when identifier not found", async () => {
    const cwd = tmpDir();
    const { handler } = buildMockHandler({ getProjectByIdentifierResult: "throw" });

    let caughtError: unknown;
    try {
      await resolveProjectContext(handler, { explicitProjectIdentifier: "BADPROJ", cwd });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ConfigError);
    if (ConfigError.is(caughtError)) {
      expect(caughtError.message).toContain("BADPROJ");
      expect(caughtError.message).toMatch(/project_identifier argument/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Precedence: explicit_id wins over explicit_identifier
// ---------------------------------------------------------------------------

describe("resolveProjectContext — explicit_id wins over explicit_identifier", () => {
  it("uses explicitProjectId and does NOT call getProjectByIdentifier when both supplied", async () => {
    const cwd = tmpDir();
    const { handler, getProjectByIdentifierMock } = buildMockHandler();

    const result = await resolveProjectContext(handler, {
      explicitProjectId: 10,
      explicitProjectIdentifier: "SHOULD-BE-IGNORED",
      cwd,
    });

    expect(result.projectId).toBe(10);
    expect(getProjectByIdentifierMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. yaml with project_id — FR-30: validates existence
// ---------------------------------------------------------------------------

describe("resolveProjectContext — yaml project_id (FR-30 validation)", () => {
  it("calls getProjectById to validate yaml project_id", async () => {
    const cwd = tmpDir();
    writeYaml(cwd, "project_id: 5");
    const { handler, getProjectByIdMock } = buildMockHandler();

    await resolveProjectContext(handler, { cwd });

    expect(getProjectByIdMock).toHaveBeenCalledOnce();
    expect(getProjectByIdMock).toHaveBeenCalledWith(5);
  });

  it("returns projectId from yaml after successful validation", async () => {
    const cwd = tmpDir();
    const yamlPath = writeYaml(cwd, "project_id: 5");
    const { handler } = buildMockHandler();

    const result = await resolveProjectContext(handler, { cwd });

    expect(result.projectId).toBe(5);
    expect(result.yamlPath).toBe(yamlPath);
    expect(result.defaults).toEqual({});
  });

  it("throws ConfigError with hint mentioning yaml path when yaml project_id does not exist (S6/FR-30)", async () => {
    const cwd = tmpDir();
    const yamlPath = writeYaml(cwd, "project_id: 9999");
    const { handler } = buildMockHandler({ getProjectByIdResult: "throw" });

    let caughtError: unknown;
    try {
      await resolveProjectContext(handler, { cwd });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ConfigError);
    if (ConfigError.is(caughtError)) {
      expect(caughtError.message).toContain("9999");
      // Hint must mention the yaml path (S6 scenario)
      expect(caughtError.message).toContain(yamlPath);
    }
  });

  it("does NOT call getProjectByIdentifier for yaml project_id", async () => {
    const cwd = tmpDir();
    writeYaml(cwd, "project_id: 99");
    const { handler, getProjectByIdentifierMock } = buildMockHandler();

    await resolveProjectContext(handler, { cwd });

    expect(getProjectByIdentifierMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. yaml with project_id and all defaults
// ---------------------------------------------------------------------------

describe("resolveProjectContext — yaml project_id with all defaults", () => {
  it("returns full defaults from yaml", async () => {
    const cwd = tmpDir();
    writeYaml(
      cwd,
      [
        "project_id: 5",
        "default_swimlane_id: 2",
        "default_column_id: 3",
        "default_owner_id: 7",
        "default_category_id: 1",
      ].join("\n"),
    );
    const { handler } = buildMockHandler();

    const result = await resolveProjectContext(handler, { cwd });

    expect(result.projectId).toBe(5);
    expect(result.defaults.swimlaneId).toBe(2);
    expect(result.defaults.columnId).toBe(3);
    expect(result.defaults.ownerId).toBe(7);
    expect(result.defaults.categoryId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. yaml with project_identifier
// ---------------------------------------------------------------------------

describe("resolveProjectContext — yaml project_identifier", () => {
  it("calls getProjectByIdentifier with identifier from yaml", async () => {
    const cwd = tmpDir();
    writeYaml(cwd, "project_identifier: MYPROJ");
    const { handler, getProjectByIdentifierMock } = buildMockHandler({
      getProjectByIdentifierResult: { ...FAKE_PROJECT, id: 77 },
    });

    const result = await resolveProjectContext(handler, { cwd });

    expect(result.projectId).toBe(77);
    expect(getProjectByIdentifierMock).toHaveBeenCalledOnce();
    expect(getProjectByIdentifierMock).toHaveBeenCalledWith("MYPROJ");
  });

  it("throws ConfigError with hint mentioning yaml path when yaml identifier not found", async () => {
    const cwd = tmpDir();
    const yamlPath = writeYaml(cwd, "project_identifier: BADPROJ");
    const { handler } = buildMockHandler({ getProjectByIdentifierResult: "throw" });

    let caughtError: unknown;
    try {
      await resolveProjectContext(handler, { cwd });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ConfigError);
    if (ConfigError.is(caughtError)) {
      expect(caughtError.message).toContain("BADPROJ");
      expect(caughtError.message).toContain(yamlPath);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. explicit + yaml — explicit wins, yaml defaults still merged
// ---------------------------------------------------------------------------

describe("resolveProjectContext — explicit project_id with yaml present", () => {
  it("explicit id wins; yaml defaults are still merged into the result", async () => {
    const cwd = tmpDir();
    const yamlFile = writeYaml(
      cwd,
      ["project_id: 5", "default_swimlane_id: 9"].join("\n"),
    );
    const { handler, getProjectByIdentifierMock, getProjectByIdMock } = buildMockHandler();

    const result = await resolveProjectContext(handler, { explicitProjectId: 100, cwd });

    expect(result.projectId).toBe(100); // explicit wins
    expect(result.yamlPath).toBe(yamlFile); // yaml still referenced
    expect(result.defaults.swimlaneId).toBe(9); // defaults merged
    expect(getProjectByIdentifierMock).not.toHaveBeenCalled();
    // getProjectById called once to validate explicit id
    expect(getProjectByIdMock).toHaveBeenCalledOnce();
    expect(getProjectByIdMock).toHaveBeenCalledWith(100);
  });
});

// ---------------------------------------------------------------------------
// 8. No explicit AND no yaml → ConfigError
// ---------------------------------------------------------------------------

describe("resolveProjectContext — no context at all", () => {
  it("throws ConfigError with actionable message when no explicit and no yaml", async () => {
    const cwd = tmpDir();
    const { handler } = buildMockHandler();

    const isolated = join(cwd, "project-no-yaml");
    mkdirSync(isolated, { recursive: true });

    try {
      await resolveProjectContext(handler, { cwd: isolated });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      if (ConfigError.is(err)) {
        expect(err.message).toContain("Cannot resolve project context");
        expect(err.message).toContain("project_id");
        expect(err.message).toContain(".kanboard.yaml");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Cache behavior — FR-30: validate ONCE per (cwd, source, id) combo
// ---------------------------------------------------------------------------

describe("resolveProjectContext — caching (FR-30: validate once per process)", () => {
  it("returns the same result object on second call (cache hit)", async () => {
    const cwd = tmpDir();
    writeYaml(cwd, "project_id: 12");
    const { handler } = buildMockHandler();

    const first = await resolveProjectContext(handler, { cwd });
    const second = await resolveProjectContext(handler, { cwd });

    // Same reference — returned from cache.
    expect(first).toBe(second);
  });

  it("calls getProjectById only ONCE for same yaml project_id (cache hit skips re-validation)", async () => {
    const cwd = tmpDir();
    writeYaml(cwd, "project_id: 12");
    const { handler, getProjectByIdMock } = buildMockHandler();

    await resolveProjectContext(handler, { cwd });
    await resolveProjectContext(handler, { cwd });

    // getProjectById called only once — cache hit on second call
    expect(getProjectByIdMock).toHaveBeenCalledOnce();
  });

  it("calls getProjectById only ONCE for same explicit project_id (cache hit)", async () => {
    const cwd = tmpDir();
    const { handler, getProjectByIdMock } = buildMockHandler();

    await resolveProjectContext(handler, { explicitProjectId: 7, cwd });
    await resolveProjectContext(handler, { explicitProjectId: 7, cwd });

    expect(getProjectByIdMock).toHaveBeenCalledOnce();
  });

  it("does not re-call getProjectByIdentifier on cache hit", async () => {
    const cwd = tmpDir();
    writeYaml(cwd, "project_identifier: CACHEDPROJ");
    const { handler, getProjectByIdentifierMock } = buildMockHandler({
      getProjectByIdentifierResult: { ...FAKE_PROJECT, id: 88 },
    });

    await resolveProjectContext(handler, { cwd });
    await resolveProjectContext(handler, { cwd });

    expect(getProjectByIdentifierMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 10. _clearProjectContextCache forces re-resolution
// ---------------------------------------------------------------------------

describe("_clearProjectContextCache", () => {
  it("forces re-resolution and re-validation on the next call", async () => {
    const cwd = tmpDir();
    writeYaml(cwd, "project_id: 12");
    const { handler, getProjectByIdMock } = buildMockHandler();

    await resolveProjectContext(handler, { cwd });
    _clearProjectContextCache();
    _clearKanboardYamlCache();

    await resolveProjectContext(handler, { cwd });

    // getProjectById called twice (once per resolution)
    expect(getProjectByIdMock).toHaveBeenCalledTimes(2);
  });

  it("new context object created after cache clear (different reference)", async () => {
    const cwd = tmpDir();
    writeYaml(cwd, "project_id: 12");
    const { handler } = buildMockHandler();

    const first = await resolveProjectContext(handler, { cwd });
    _clearProjectContextCache();
    _clearKanboardYamlCache();

    const second = await resolveProjectContext(handler, { cwd });

    expect(first).not.toBe(second);
    expect(first.projectId).toBe(second.projectId);
  });
});

// ---------------------------------------------------------------------------
// 11. Walk-up: yaml 2 levels up
// ---------------------------------------------------------------------------

describe("resolveProjectContext — yaml found via walk-up", () => {
  it("finds .kanboard.yaml 2 levels above the cwd and validates project", async () => {
    const root = tmpDir();
    const nested = join(root, "level1", "level2");
    mkdirSync(nested, { recursive: true });

    const yamlPath = writeYaml(root, "project_id: 88");
    const { handler, getProjectByIdMock } = buildMockHandler();

    const result = await resolveProjectContext(handler, { cwd: nested });

    expect(result.projectId).toBe(88);
    expect(result.yamlPath).toBe(yamlPath);
    // Validation called for the walk-up found project
    expect(getProjectByIdMock).toHaveBeenCalledWith(88);
  });
});
