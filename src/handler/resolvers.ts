/**
 * Resolvers — small collaborator class that owns column-name and swimlane
 * caches per project for the lifetime of the MCP handler process.
 *
 * Responsibilities:
 * - Resolve a column name (string) to its numeric column_id for a project.
 * - Resolve the default swimlane_id for a project (explicit yaml default >
 *   first active swimlane > ConfigError).
 * - Cache PROMISES (not resolved values) so concurrent callers share one
 *   inflight fetch per project.
 * - Invalidate cache entries on error so transient failures do not poison
 *   the cache across retries.
 *
 * Consumed exclusively by the tool layer (Batch C).
 * `KanboardHandler` does NOT depend on `Resolvers`.
 */

import type { Logger } from "pino";
import { NotFoundError, ConfigError, KanboardApiError } from "../shared/errors.js";
import type { Column, Swimlane } from "../shared/types.js";
import { createLogger } from "../shared/logger.js";
import type { KanboardHandler } from "./kanboard.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolversOptions {
  /** Injected KanboardHandler — one-way dependency (handler ← tools, resolvers → handler). */
  handler: KanboardHandler;
  /** Optional Pino logger (defaults to createLogger()). */
  logger?: Logger;
}

/**
 * Per-project column-name and swimlane caches.
 *
 * Designed for the tool layer — each tool that needs `column_name` resolution
 * or swimlane defaulting goes through here instead of hitting the API on every
 * call.
 *
 * ### Cache strategy
 * Both caches store `Promise<Column[]>` / `Promise<Swimlane[]>` indexed by
 * `projectId`. Storing the promise (not the resolved value) ensures that
 * concurrent callers share a single inflight fetch per project — avoids N
 * identical requests firing simultaneously when a tool is called many times
 * before the first fetch resolves.
 *
 * If the inflight promise rejects, the cache entry is dropped so the next
 * caller retries cleanly.
 *
 * ### Invalidation
 * `invalidate(projectId)` drops both column and swimlane entries for a
 * project. Tools call this when a Kanboard mutation against that project
 * returns an error — guards against stale column lists (e.g. a column was
 * renamed between calls).
 */
export class Resolvers {
  readonly #handler: KanboardHandler;
  readonly #logger: Logger;

  /** column cache: projectId → inflight or resolved Promise<Column[]> */
  readonly #columnCache = new Map<number, Promise<Column[]>>();
  /** swimlane cache: projectId → inflight or resolved Promise<Swimlane[]> */
  readonly #swimlaneCache = new Map<number, Promise<Swimlane[]>>();

  public constructor(opts: ResolversOptions) {
    this.#handler = opts.handler;
    this.#logger = opts.logger ?? createLogger();
  }

  // ---------------------------------------------------------------------------
  // Column resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve a column name to its numeric ID for the given project.
   *
   * - Cache miss: fetches `getColumns(projectId)` and caches the promise.
   *   If the fetch rejects, the cache entry is removed so the next caller
   *   retries (transient failure protection).
   * - Match is case-insensitive.
   * - Multiple matches (same title) → throws `KanboardApiError` (API_ERROR)
   *   listing the matched column IDs so the caller can disambiguate by id.
   * - No match → throws `NotFoundError` (NOT_FOUND) listing all valid column names.
   *
   * @param projectId  - Kanboard project id.
   * @param columnName - Human-readable column title (e.g. "In Progress").
   * @returns The numeric column id.
   * @throws {KanboardApiError} when columnName matches more than one column
   *   (ambiguous — caller must disambiguate by id).
   * @throws {NotFoundError} when columnName is not found (message includes valid names).
   * @throws {KanboardApiError} when the underlying `getColumns` call fails.
   */
  public async resolveColumnIdByName(projectId: number, columnName: string): Promise<number> {
    const columns = await this.#fetchColumns(projectId);

    const needle = columnName.toLowerCase();
    const matches = columns.filter((c) => c.title.toLowerCase() === needle);

    if (matches.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const only = matches[0]!;
      this.#logger.debug(
        { projectId, columnName, columnId: only.id },
        "resolvers: column resolved by name",
      );
      return only.id;
    }

    if (matches.length > 1) {
      const matchedIds = matches.map((c) => c.id);
      this.#logger.warn(
        { projectId, columnName, matchedIds },
        "resolvers: column name ambiguous — API_ERROR",
      );
      throw new KanboardApiError(
        "resolveColumnIdByName",
        `Column name "${columnName}" is ambiguous in project ${String(projectId)} — ` +
          `${String(matches.length)} columns share this title. ` +
          `Disambiguate by passing column_id directly. ` +
          `Matched ids: ${matchedIds.map(String).join(", ")}.`,
      );
    }

    const validNames = columns.map((c) => c.title);
    this.#logger.warn(
      { projectId, columnName, validNames },
      "resolvers: column not found — NotFoundError",
    );
    throw new NotFoundError(
      "resolveColumnIdByName",
      `Column "${columnName}" not found in project ${String(projectId)}. ` +
        `Available columns: ${validNames.map((n) => `"${n}"`).join(", ")}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Swimlane resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve the swimlane to use for a project.
   *
   * Resolution order:
   * 1. `yamlDefault` (from `.kanboard.yaml default_swimlane_id`) — returned
   *    immediately without any fetch.
   * 2. First active swimlane from `getActiveSwimlanes(projectId)`.
   * 3. Empty active-swimlane list → throws `ConfigError`.
   *
   * @param projectId   - Kanboard project id.
   * @param yamlDefault - Optional explicit swimlane_id from .kanboard.yaml.
   * @returns The swimlane_id to use.
   * @throws {ConfigError} when no active swimlanes exist and no default was provided.
   * @throws {KanboardApiError} when the underlying `getActiveSwimlanes` call fails.
   */
  public async resolveDefaultSwimlaneId(
    projectId: number,
    yamlDefault?: number,
  ): Promise<number> {
    // 1. Explicit yaml default — no network call needed.
    if (yamlDefault !== undefined) {
      this.#logger.debug(
        { projectId, swimlaneId: yamlDefault, source: "yaml" },
        "resolvers: swimlane resolved from yaml default",
      );
      return yamlDefault;
    }

    // 2. Fetch active swimlanes (cached).
    const swimlanes = await this.#fetchSwimlanes(projectId);

    if (swimlanes.length === 0) {
      throw new ConfigError(
        `No active swimlanes for project ${String(projectId)}; ` +
          `provide swimlane_id explicitly or set default_swimlane_id in .kanboard.yaml`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const first = swimlanes[0]!;
    this.#logger.debug(
      { projectId, swimlaneId: first.id, swimlaneName: first.name, source: "first-active" },
      "resolvers: swimlane resolved from first active",
    );
    return first.id;
  }

  // ---------------------------------------------------------------------------
  // Cache invalidation
  // ---------------------------------------------------------------------------

  /**
   * Drop cached entries for a single project.
   *
   * Tools call this when a Kanboard call against the project fails — protects
   * against stale column lists (e.g. a column was renamed).
   *
   * @param projectId - Project whose cache entries should be dropped.
   */
  public invalidate(projectId: number): void {
    const deletedColumns = this.#columnCache.delete(projectId);
    const deletedSwimlanes = this.#swimlaneCache.delete(projectId);
    this.#logger.debug(
      { projectId, deletedColumns, deletedSwimlanes },
      "resolvers: cache invalidated for project",
    );
  }

  /**
   * Drop ALL cached entries.
   *
   * Useful in tests. Rarely needed in production (cache lifetime = process).
   */
  public invalidateAll(): void {
    const projectCount = Math.max(this.#columnCache.size, this.#swimlaneCache.size);
    this.#columnCache.clear();
    this.#swimlaneCache.clear();
    this.#logger.debug({ projectCount }, "resolvers: all caches cleared");
  }

  // ---------------------------------------------------------------------------
  // Private fetch helpers (with cache + self-healing on rejection)
  // ---------------------------------------------------------------------------

  /**
   * Return (or create) the inflight/resolved promise for columns of a project.
   * If the promise rejects, we drop the entry so the next caller retries.
   */
  #fetchColumns(projectId: number): Promise<Column[]> {
    const cached = this.#columnCache.get(projectId);
    if (cached !== undefined) {
      return cached;
    }

    const promise = this.#handler.getColumns(projectId).catch((err: unknown) => {
      // Transient failure: evict the cache so the next call retries.
      this.#columnCache.delete(projectId);
      this.#logger.warn(
        { projectId, error: err instanceof Error ? err.message : String(err) },
        "resolvers: getColumns failed — cache entry evicted",
      );
      throw err;
    });

    this.#columnCache.set(projectId, promise);
    return promise;
  }

  /**
   * Return (or create) the inflight/resolved promise for swimlanes of a project.
   * If the promise rejects, we drop the entry so the next caller retries.
   */
  #fetchSwimlanes(projectId: number): Promise<Swimlane[]> {
    const cached = this.#swimlaneCache.get(projectId);
    if (cached !== undefined) {
      return cached;
    }

    const promise = this.#handler.getActiveSwimlanes(projectId).catch((err: unknown) => {
      // Transient failure: evict the cache so the next call retries.
      this.#swimlaneCache.delete(projectId);
      this.#logger.warn(
        { projectId, error: err instanceof Error ? err.message : String(err) },
        "resolvers: getActiveSwimlanes failed — cache entry evicted",
      );
      throw err;
    });

    this.#swimlaneCache.set(projectId, promise);
    return promise;
  }
}
