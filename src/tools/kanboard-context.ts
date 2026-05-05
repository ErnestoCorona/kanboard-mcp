/**
 * Project context resolver for MCP tools.
 *
 * Implements the precedence chain defined in the spec (FR-02):
 *
 *   explicit project_id  >  explicit project_identifier  >  .kanboard.yaml  >  ConfigError
 *
 * Key design decisions:
 * - Project existence validation (S6, FR-30): after resolving the numeric project_id
 *   (from yaml or explicit arg), the resolver calls `getProjectById(projectId)` to
 *   confirm the project exists on the server. On NotFoundError it throws a ConfigError
 *   with a clear hint pointing at the source (yaml path or arg name). This validation
 *   is performed ONCE per (cwd, source, id) combination and the result is cached for
 *   the process lifetime — subsequent calls with the same key skip the round-trip.
 *   NOTE: config-load step (FR-02) does NOT make any network call (spec-compliant).
 *   The validation happens here, on the first tool call that consumes a project context.
 * - Identifier resolution: `getProjectByIdentifier` already throws NotFoundError when
 *   the identifier is unknown; that error is re-wrapped in ConfigError for consistency.
 * - Caching: results are cached by resolved cwd string so repeated tool calls
 *   within the same process pay zero cost after the first resolution.
 * - Defaults: optional fields from .kanboard.yaml are merged regardless of
 *   whether project_id was explicit or yaml-sourced.
 */

import { resolveKanboardYaml } from "../config/kanboard-yaml.js";
import type { KanboardYamlConfig } from "../config/kanboard-yaml.js";
import { ConfigError, NotFoundError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Resolved project context — returned by `resolveProjectContext`.
 *
 * `yamlPath` is null when no .kanboard.yaml was found (project was provided
 * via explicit arg). `defaults` is empty when no optional yaml fields exist.
 */
export interface ResolvedProjectContext {
  projectId: number;
  /** Absolute path to the .kanboard.yaml used, or null when no yaml was involved. */
  yamlPath: string | null;
  defaults: {
    swimlaneId?: number;
    columnId?: number;
    ownerId?: number;
    categoryId?: number;
  };
}

/**
 * Options for `resolveProjectContext`.
 */
export interface ProjectContextOptions {
  /** Explicit project_id passed in tool args — wins over yaml. */
  explicitProjectId?: number;
  /** Explicit project_identifier passed in tool args — wins over yaml. */
  explicitProjectIdentifier?: string;
  /** Working directory to walk up from. Defaults to process.cwd(). */
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

/**
 * Process-lifetime cache keyed by resolved cwd.
 *
 * Maps the key `<resolvedCwd>|<source>|<id-or-identifier>` → resolved context promise.
 * Storing promises (not values) ensures concurrent callers with the same key
 * share a single in-flight resolution instead of launching duplicate requests.
 */
const _cache = new Map<string, Promise<ResolvedProjectContext>>();

/**
 * Clear the project context cache.
 *
 * **For testing only.** Call between tests to isolate state.
 * @internal
 */
export function _clearProjectContextCache(): void {
  _cache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build cache key from resolution inputs.
 */
function cacheKey(resolvedCwd: string, source: string, id: string | number): string {
  return `${resolvedCwd}|${source}|${String(id)}`;
}

/**
 * Extract the optional default fields from a KanboardYamlConfig (if available).
 */
function extractDefaults(yamlConfig: KanboardYamlConfig | null | undefined): ResolvedProjectContext["defaults"] {
  if (yamlConfig == null) return {};
  const defaults: ResolvedProjectContext["defaults"] = {};
  if (yamlConfig.default_swimlane_id !== undefined) defaults.swimlaneId = yamlConfig.default_swimlane_id;
  if (yamlConfig.default_column_id !== undefined) defaults.columnId = yamlConfig.default_column_id;
  if (yamlConfig.default_owner_id !== undefined) defaults.ownerId = yamlConfig.default_owner_id;
  if (yamlConfig.default_category_id !== undefined) defaults.categoryId = yamlConfig.default_category_id;
  return defaults;
}

/**
 * Validate that a project exists on the server via getProjectById.
 *
 * On success: resolves to the project id (unchanged).
 * On NotFoundError: wraps in ConfigError with a hint pointing at the source.
 *
 * @param handler    - KanboardHandler to call getProjectById.
 * @param projectId  - Numeric project id to validate.
 * @param sourceHint - Human-readable hint for the error message (e.g. "from .kanboard.yaml at /path").
 */
async function validateProjectExists(
  handler: KanboardHandler,
  projectId: number,
  sourceHint: string,
): Promise<void> {
  try {
    await handler.getProjectById(projectId);
  } catch (err) {
    if (NotFoundError.is(err)) {
      throw new ConfigError(
        `Project ID ${String(projectId)} (${sourceHint}) does not exist on the Kanboard server. ` +
          `Check the project_id or update your .kanboard.yaml.`,
        { projectId, sourceHint },
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the project context for a tool call.
 *
 * Precedence (first match wins — FR-02):
 * 1. `opts.explicitProjectId` — used as-is; project existence validated via getProjectById (FR-30).
 * 2. `opts.explicitProjectIdentifier` — resolved via `handler.getProjectByIdentifier()`
 *    to a numeric id (identifier resolution already validates existence).
 * 3. `.kanboard.yaml` walk-up:
 *    - yaml has `project_id` → validated via `handler.getProjectById()` (FR-30).
 *    - yaml has `project_identifier` → resolved via `handler.getProjectByIdentifier()`.
 * 4. None — throws `ConfigError` with actionable message.
 *
 * Results are cached per (cwd, source, id/identifier) for the process lifetime.
 * The validation getProjectById call is thus made ONCE per unique project context.
 *
 * @param handler - KanboardHandler, used for identifier resolution and existence validation.
 * @param opts    - Resolution options (explicit args and/or cwd override).
 * @returns       - Resolved `{projectId, yamlPath, defaults}`.
 * @throws {ConfigError}    when no context can be resolved, or when project does not exist (FR-30).
 * @throws {NotFoundError}  when `getProjectByIdentifier` finds no match (propagated as ConfigError).
 */
export async function resolveProjectContext(
  handler: KanboardHandler,
  opts?: ProjectContextOptions,
): Promise<ResolvedProjectContext> {
  const resolvedCwd = resolve(opts?.cwd ?? process.cwd());

  // ── 1. Explicit project_id ──────────────────────────────────────────────

  if (opts?.explicitProjectId !== undefined) {
    const key = cacheKey(resolvedCwd, "explicit-id", opts.explicitProjectId);
    const hit = _cache.get(key);
    if (hit !== undefined) return hit;

    const explicitProjectId = opts.explicitProjectId;
    const promise = (async (): Promise<ResolvedProjectContext> => {
      // Validate existence (FR-30) — throws ConfigError on NotFoundError.
      await validateProjectExists(
        handler,
        explicitProjectId,
        `passed as project_id argument`,
      );

      // Merge yaml defaults if yaml is present in the tree.
      const yaml = resolveKanboardYaml(resolvedCwd);
      return {
        projectId: explicitProjectId,
        yamlPath: yaml?.path ?? null,
        defaults: extractDefaults(yaml?.config),
      };
    })();

    _cache.set(key, promise);
    return promise;
  }

  // ── 2. Explicit project_identifier ─────────────────────────────────────

  if (opts?.explicitProjectIdentifier !== undefined) {
    const key = cacheKey(resolvedCwd, "explicit-identifier", opts.explicitProjectIdentifier);
    const hit = _cache.get(key);
    if (hit !== undefined) return hit;

    const explicitIdentifier = opts.explicitProjectIdentifier;
    const promise = (async (): Promise<ResolvedProjectContext> => {
      // getProjectByIdentifier throws NotFoundError if not found — existence is validated implicitly.
      let project;
      try {
        project = await handler.getProjectByIdentifier(explicitIdentifier);
      } catch (err) {
        if (NotFoundError.is(err)) {
          throw new ConfigError(
            `Project identifier "${explicitIdentifier}" (passed as project_identifier argument) ` +
              `does not exist on the Kanboard server. Check your project_identifier arg.`,
            { identifier: explicitIdentifier, sourceHint: "project_identifier argument" },
          );
        }
        throw err;
      }

      const yaml = resolveKanboardYaml(resolvedCwd);
      return {
        projectId: project.id,
        yamlPath: yaml?.path ?? null,
        defaults: extractDefaults(yaml?.config),
      };
    })();

    _cache.set(key, promise);
    return promise;
  }

  // ── 3. .kanboard.yaml walk-up ───────────────────────────────────────────

  const yaml = resolveKanboardYaml(resolvedCwd);

  if (yaml !== null) {
    const yamlConfig = yaml.config;

    if (yamlConfig.project_id !== undefined) {
      // yaml has numeric id — validate existence (FR-30).
      const key = cacheKey(resolvedCwd, "yaml-id", yamlConfig.project_id);
      const hit = _cache.get(key);
      if (hit !== undefined) return hit;

      const yamlPath = yaml.path;
      const projectId = yamlConfig.project_id;

      const promise = (async (): Promise<ResolvedProjectContext> => {
        await validateProjectExists(
          handler,
          projectId,
          `from .kanboard.yaml at ${yamlPath}`,
        );

        return {
          projectId,
          yamlPath,
          defaults: extractDefaults(yamlConfig),
        };
      })();

      _cache.set(key, promise);
      return promise;
    }

    if (yamlConfig.project_identifier !== undefined) {
      // yaml has identifier — resolve via handler (existence validated by the call).
      const key = cacheKey(resolvedCwd, "yaml-identifier", yamlConfig.project_identifier);
      const hit = _cache.get(key);
      if (hit !== undefined) return hit;

      const yamlPath = yaml.path;
      const identifier = yamlConfig.project_identifier;

      const promise = (async (): Promise<ResolvedProjectContext> => {
        let project;
        try {
          project = await handler.getProjectByIdentifier(identifier);
        } catch (err) {
          if (NotFoundError.is(err)) {
            throw new ConfigError(
              `Project identifier "${identifier}" (from .kanboard.yaml at ${yamlPath}) ` +
                `does not exist on the Kanboard server. Update .kanboard.yaml or pass project_id explicitly.`,
              { identifier, sourceHint: `from .kanboard.yaml at ${yamlPath}` },
            );
          }
          throw err;
        }

        return {
          projectId: project.id,
          yamlPath,
          defaults: extractDefaults(yamlConfig),
        };
      })();

      _cache.set(key, promise);
      return promise;
    }

    // yaml was loaded but has neither project_id nor project_identifier — this
    // should have been caught by Zod refine in loadKanboardYaml, but guard anyway.
    throw new ConfigError(
      `.kanboard.yaml at ${yaml.path} has neither project_id nor project_identifier. ` +
        `This should have been caught at load time — check your yaml schema.`,
    );
  }

  // ── 4. Nothing found ────────────────────────────────────────────────────

  throw new ConfigError(
    "Cannot resolve project context. " +
      "Pass project_id explicitly OR create a .kanboard.yaml file in your project root " +
      `(walk-up started from: ${resolvedCwd}).`,
  );
}
