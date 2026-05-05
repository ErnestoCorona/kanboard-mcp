/**
 * Shared domain types for kanboard-mcp.
 *
 * These are plain TypeScript types — NOT Zod schemas.
 * Zod schemas live in `src/schemas/` (Batch A.2).
 *
 * Date fields are ISO 8601 strings after normalization (epoch → ISO
 * conversion happens in the schema layer, not here).
 *
 * Nullable FK fields (category_id, swimlane_id, owner_id, etc.) are
 * `number | null` — the "0" / "" Kanboard sentinel is coerced to null
 * in the schema layer.
 *
 * Boolean fields are typed as `boolean` — the "0"/"1" Kanboard representation
 * is coerced in the schema layer.
 */

// ---------------------------------------------------------------------------
// Auth mode
// ---------------------------------------------------------------------------

/**
 * Kanboard authentication mode.
 *
 * - `personal`: HTTP Basic using `<KANBOARD_USERNAME>:<KANBOARD_API_TOKEN>`.
 * - `app`: HTTP Basic using `jsonrpc:<KANBOARD_API_TOKEN>` (admin-level access).
 */
export type KanboardAuthMode = "personal" | "app";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Runtime configuration for the Kanboard MCP handler.
 * Populated from env vars (see `src/config/env.ts`).
 */
export interface KanboardConfig {
  /** Base URL of the Kanboard instance, e.g. `https://pm.example.com`. */
  url: string;
  /** API token from Kanboard settings (global token or personal token). */
  apiToken: string;
  /** Auth mode — determines the HTTP Basic username. */
  mode: KanboardAuthMode;
  /**
   * Username for personal-mode auth.
   * Required when `mode === "personal"`, unused when `mode === "app"`.
   */
  username?: string | undefined;
  /** Per-request timeout in milliseconds. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number | undefined;
}

// ---------------------------------------------------------------------------
// JSON-RPC batch support types
// ---------------------------------------------------------------------------

/**
 * A single item in a JSON-RPC 2.0 batch request.
 */
export interface BatchCall {
  method: string;
  params: object;
  /** Used for id-matching in the batch response (not necessarily request order). */
  id: number;
}

/**
 * Result of one item in a JSON-RPC 2.0 batch response.
 * Discriminated union: `ok` distinguishes success from error.
 */
export type BatchResult<T> =
  | { ok: true; index: number; result: T }
  | { ok: false; index: number; error: { code: number; message: string } };

// ---------------------------------------------------------------------------
// Batch create tasks types
// ---------------------------------------------------------------------------

/**
 * Input shape for a single item in `create_tasks_batch`.
 * Mirrors `createTask` optional fields — all except `title` are optional.
 */
export interface BatchCreateTasksItem {
  title: string;
  description?: string | undefined;
  column_id?: number | undefined;
  owner_id?: number | undefined;
  category_id?: number | undefined;
  swimlane_id?: number | undefined;
  color_id?: string | undefined;
  /** Unix epoch seconds — already converted from ISO 8601 input by the tool layer. */
  date_due?: number | undefined;
  score?: number | undefined;
  priority?: number | undefined;
  reference?: string | undefined;
  tags?: string[] | undefined;
  /** Unix epoch seconds — already converted from ISO 8601 input by the tool layer. */
  date_started?: number | undefined;
}

/**
 * Output shape returned by `create_tasks_batch`.
 * Never throws on partial failure — all outcomes are in created[] or failed[].
 */
export interface BatchCreateTasksResult {
  created: {
    index: number;
    task_id: number;
    title: string;
  }[];
  failed: {
    index: number;
    title: string;
    error: {
      code: string;
      message: string;
    };
  }[];
}

// ---------------------------------------------------------------------------
// Domain types — Kanboard JSON-RPC response shapes (normalized)
// ---------------------------------------------------------------------------

/**
 * Kanboard Project URL shape returned by the API.
 * Kanboard v1.2+ returns an object with board and list URLs instead of a plain string.
 */
export interface ProjectUrl {
  board: string;
  list: string;
}

/**
 * Kanboard Project entity.
 */
export interface Project {
  id: number;
  name: string;
  identifier: string;
  /** Empty string when Kanboard returns null (no description set). */
  description: string;
  is_active: boolean;
  is_public: boolean;
  is_private: boolean;
  token: string;
  owner_id: number | null;
  default_swimlane: string;
  show_default_swimlane: boolean;
  start_date: string | null;
  end_date: string | null;
  /** Object with board/list URLs (Kanboard v1.2+), plain string (older), or "" when absent. */
  url: ProjectUrl | string;
}

/**
 * Kanboard Task entity.
 */
export interface Task {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: boolean;
  column_id: number | null;
  swimlane_id: number | null;
  owner_id: number | null;
  creator_id: number | null;
  category_id: number | null;
  color_id: string;
  position: number;
  priority: number;
  score: number;
  reference: string;
  tags: string[];
  /** ISO 8601 — normalized from epoch seconds. */
  date_creation: string;
  /** ISO 8601 — normalized from epoch seconds. */
  date_modification: string;
  /** ISO 8601 or null — normalized from epoch seconds. */
  date_due: string | null;
  /** ISO 8601 or null — normalized from epoch seconds. */
  date_started: string | null;
  /** ISO 8601 or null — normalized from epoch seconds. */
  date_moved: string | null;
  /** ISO 8601 or null — normalized from epoch seconds. */
  date_completed: string | null;
  url: string;
}

/**
 * Kanboard Subtask entity.
 */
export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  status: number;
  time_estimated: number;
  time_spent: number;
  user_id: number | null;
}

/**
 * Kanboard Comment entity.
 */
export interface Comment {
  id: number;
  task_id: number;
  user_id: number;
  content: string;
  reference: string;
  visibility: string;
  /** ISO 8601 — normalized from epoch seconds. */
  date_creation: string;
  /** ISO 8601 — normalized from epoch seconds. */
  date_modification: string;
}

/**
 * Kanboard Column entity.
 */
export interface Column {
  id: number;
  project_id: number;
  title: string;
  position: number;
  task_limit: number;
  description: string;
  hide_in_dashboard: boolean;
}

/**
 * Kanboard Category entity.
 */
export interface Category {
  id: number;
  project_id: number;
  name: string;
  color_id: string;
}

/**
 * Kanboard Swimlane entity.
 */
export interface Swimlane {
  id: number;
  project_id: number;
  name: string;
  description: string;
  position: number;
  is_active: boolean;
}

/**
 * Kanboard User entity.
 */
export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  is_admin: boolean;
  avatar_path: string | null;
}

/**
 * Lightweight project-member entry returned by `getProjectUsers`.
 *
 * Kanboard's `getProjectUsers(project_id)` returns a sparse `{ user_id: username }`
 * dict — this type is the typed array shape the handler exposes after
 * normalization. It does NOT include role, email, or admin flags (those
 * require admin-level methods like `getAllUsers`).
 */
export interface ProjectMember {
  user_id: number;
  username: string;
}

/**
 * Kanboard FileAttachment entity (task file).
 */
export interface FileAttachment {
  id: number;
  task_id: number;
  project_id: number;
  name: string;
  path: string;
  is_image: boolean;
  size: number;
  user_id: number | null;
  /** ISO 8601 — normalized from epoch seconds. */
  date: string;
}
