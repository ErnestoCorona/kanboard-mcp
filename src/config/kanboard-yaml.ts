/**
 * .kanboard.yaml walk-up resolver.
 *
 * Walks up the directory tree from a given start directory, stopping at the
 * git root (a directory containing `.git`), `$HOME`, or filesystem root —
 * whichever is reached first — and parses/validates any `.kanboard.yaml`
 * found along the way (FR-02, S6). The git-root boundary prevents the
 * resolver from escaping into a sibling repo in monorepo or nested-repo
 * setups.
 *
 * Design constraints:
 * - Absence of the file is NOT an error — callers fall back to explicit args.
 * - Schema violations at load time → ConfigError naming the field.
 * - project_id XOR project_identifier must be set (exactly one).
 * - project_id is NOT validated against the Kanboard server at config-load time
 *   (that validation happens lazily on first tool call per FR-30).
 * - File contents are cached for the process lifetime, keyed by absolute path.
 *   Cache is a module-level Map. Callers must restart the process to pick up
 *   file changes (acceptable for v1).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ConfigError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for `.kanboard.yaml` content.
 *
 * Exactly one of `project_id` or `project_identifier` must be set.
 * All other fields are optional.
 */
export const KanboardYamlSchema = z
  .object({
    project_id: z.number().int().positive().optional(),
    project_identifier: z
      .string()
      .regex(/^[A-Z0-9_-]+$/i, "project_identifier must match ^[A-Z0-9_-]+$i")
      .optional(),
    default_swimlane_id: z.number().int().positive().optional(),
    default_column_id: z.number().int().positive().optional(),
    default_owner_id: z.number().int().positive().optional(),
    default_category_id: z.number().int().positive().optional(),
  })
  .refine(
    (v) => (v.project_id !== undefined) !== (v.project_identifier !== undefined),
    {
      message:
        "Exactly one of project_id or project_identifier must be set in .kanboard.yaml " +
        "(they are mutually exclusive — use project_id for numeric IDs, " +
        "project_identifier for string identifiers like 'PROJ').",
    },
  );

/**
 * Inferred TypeScript type from the Zod schema.
 *
 * Note: After the refine, exactly one of `project_id` / `project_identifier`
 * is guaranteed to be defined at runtime. TypeScript sees both as optional
 * (Zod does not narrow after refine) — callers must check which is present.
 */
export type KanboardYamlConfig = z.infer<typeof KanboardYamlSchema>;

// ---------------------------------------------------------------------------
// Internal cache
// ---------------------------------------------------------------------------

/**
 * Module-level cache: absolute resolved path → parsed config (or null for
 * "file found but empty" — which can't pass schema, so effectively unused).
 *
 * Keyed by the absolute path returned by `resolve()` to avoid duplicate
 * entries for the same file accessed via different relative paths.
 *
 * Process-lifetime cache: restart the server to pick up file changes.
 */
const _cache = new Map<string, KanboardYamlConfig>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KANBOARD_YAML_FILENAME = ".kanboard.yaml" as const;
const HOME = homedir();
/** Safety cap: stop walking up after this many directory levels. */
const MAX_WALK_ITERATIONS = 50;

// ---------------------------------------------------------------------------
// Walk-up search
// ---------------------------------------------------------------------------

/**
 * Walk from `startDir` upward, stopping at the first directory that either:
 * - Contains a `.kanboard.yaml` file (returns its absolute path), OR
 * - Is a git root (contains a `.git` entry — directory or file for worktrees /
 *   submodules; treated as project boundary, returns null), OR
 * - Is `$HOME` (returns null — no file found up to home), OR
 * - Is the filesystem root (returns null).
 *
 * A safety cap of {@link MAX_WALK_ITERATIONS} prevents infinite loops on
 * pathological symlink graphs.
 *
 * The `.kanboard.yaml` check runs BEFORE the git-root check at every level,
 * so a yaml file colocated with `.git` at the repo root is still picked up.
 *
 * @param startDir - Absolute path to start searching from. Typically `process.cwd()`.
 * @returns Absolute path of the first `.kanboard.yaml` found, or `null`.
 */
export function findKanboardYaml(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir);
  let iterations = 0;

  for (;;) {
    if (iterations++ >= MAX_WALK_ITERATIONS) {
      break;
    }

    const candidate = join(current, KANBOARD_YAML_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }

    // Stop at git root: .git in the current directory marks the project
    // boundary; do not walk past it. Prevents the resolver from picking up
    // an unrelated yaml in a parent repo (monorepo / nested-repo setups).
    if (existsSync(join(current, ".git"))) {
      break;
    }

    // Stop at $HOME
    if (current === HOME) {
      break;
    }

    const parent = dirname(current);
    // Stop at filesystem root
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parser / validator
// ---------------------------------------------------------------------------

/**
 * Read, parse (YAML), and Zod-validate a `.kanboard.yaml` file.
 *
 * Uses the module-level cache to avoid re-reading the same file within a
 * process. Cache is keyed by the resolved absolute path.
 *
 * @param filePath - Absolute path to the `.kanboard.yaml` file.
 * @returns Validated `KanboardYamlConfig`.
 * @throws {ConfigError} when:
 *   - The file cannot be read (permissions, missing after find).
 *   - The file is not valid YAML syntax.
 *   - The parsed content fails Zod schema validation (including the XOR refine).
 */
export function loadKanboardYaml(filePath: string): KanboardYamlConfig {
  const absolutePath = resolve(filePath);

  // Cache hit — return the previously parsed config.
  const cached = _cache.get(absolutePath);
  if (cached !== undefined) {
    return cached;
  }

  // --- 1. Read ---
  let raw: string;
  try {
    raw = readFileSync(absolutePath, "utf8");
  } catch (err) {
    throw new ConfigError(
      `Cannot read .kanboard.yaml at ${absolutePath}: ${String(err)}. ` +
        `Check that the file exists and is readable.`,
      err,
    );
  }

  // --- 2. Parse YAML ---
  let parsed: unknown;
  try {
    parsed = parseYaml(raw) as unknown;
  } catch (err) {
    throw new ConfigError(
      `Cannot parse .kanboard.yaml at ${absolutePath} as YAML: ${String(err)}. ` +
        `Check the file for YAML syntax errors.`,
      err,
    );
  }

  // --- 3. Zod-validate ---
  const result = KanboardYamlSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.length > 0 ? i.path.join(".") : "root"}: ${i.message}`)
      .join("\n");

    throw new ConfigError(
      `.kanboard.yaml at ${absolutePath} is invalid:\n${issues}`,
      result.error.issues,
    );
  }

  // Store in cache and return.
  _cache.set(absolutePath, result.data);
  return result.data;
}

// ---------------------------------------------------------------------------
// Combined resolver
// ---------------------------------------------------------------------------

/**
 * Locate and load `.kanboard.yaml` by walking up from `startDir`.
 *
 * Combines {@link findKanboardYaml} and {@link loadKanboardYaml}.
 * Absence of the file is not an error — returns `null` in that case.
 *
 * Note (NFR S6): this function does NOT validate that `project_id` exists on
 * the Kanboard server. That validation happens lazily on first tool call (FR-30).
 *
 * @param startDir - Directory to start walking from (defaults to `process.cwd()`).
 * @returns `{ path, config }` when a file is found and valid, `null` otherwise.
 * @throws {ConfigError} when a file is found but cannot be read or is invalid.
 *
 * @example
 * ```ts
 * const yaml = resolveKanboardYaml(process.cwd());
 * if (yaml !== null) {
 *   console.log("Using project context from", yaml.path);
 *   // yaml.config.project_id or yaml.config.project_identifier is set
 * }
 * ```
 */
export function resolveKanboardYaml(
  startDir: string = process.cwd(),
): { path: string; config: KanboardYamlConfig } | null {
  const filePath = findKanboardYaml(startDir);
  if (filePath === null) {
    return null;
  }

  const config = loadKanboardYaml(filePath);
  return { path: filePath, config };
}

// ---------------------------------------------------------------------------
// Test helper — cache invalidation
// ---------------------------------------------------------------------------

/**
 * Clear the module-level YAML cache.
 *
 * **For testing only.** Call between tests to isolate file system state.
 * In production the cache is process-lifetime.
 *
 * @internal
 */
export function _clearKanboardYamlCache(): void {
  _cache.clear();
}
