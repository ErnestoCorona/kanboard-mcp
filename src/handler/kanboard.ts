/**
 * Typed Kanboard JSON-RPC method layer.
 *
 * This class wraps `ApiClient` with one method per Kanboard JSON-RPC procedure.
 * It is the ONLY place that understands Kanboard's `null` / `false` / `true`
 * result semantics — api-client is transport-agnostic.
 *
 * Three private decoder shapes:
 * - `#decodeGetSingle` — null → NotFoundError; Zod fail → ValidationError.
 * - `#decodeGetList`   — false → KanboardApiError; parse each item, drop malformed.
 * - `#decodeMutation`  — false → KanboardApiError; integer → number; true → undefined.
 *
 * `getMe()` cache: kicked off eagerly in the ctor (eager-but-non-fatal).
 * The rejected promise is stored and surfaces only when `getMe()` is awaited.
 */

import type { Logger } from "pino";
import type { ZodTypeAny, ZodError, ZodIssue } from "zod";
import {
  KanboardApiError,
  NotFoundError,
  ValidationError,
  AuthError,
} from "../shared/errors.js";
import type {
  Project,
  Task,
  Subtask,
  Column,
  Category,
  Swimlane,
  User,
  ProjectMember,
  BatchCall,
  BatchCreateTasksItem,
  BatchCreateTasksResult,
} from "../shared/types.js";
import { BATCH_TASK_CAP } from "../shared/constants.js";
import {
  ProjectSchema,
  TaskSchema,
  SubtaskSchema,
  ColumnSchema,
  CategorySchema,
  SwimlaneSchema,
  UserSchema,
} from "../schemas/index.js";
import { createLogger } from "../shared/logger.js";
import type { ApiClient } from "./api-client.js";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface KanboardHandlerOptions {
  apiClient: ApiClient;
  logger?: Logger;
}

// ─── Input types (not Zod — those live in the tools layer) ────────────────

export interface CreateTaskInput {
  title: string;
  project_id: number;
  description?: string | undefined;
  color_id?: string | undefined;
  column_id?: number | undefined;
  owner_id?: number | undefined;
  creator_id?: number | undefined;
  /** ISO 8601 string — caller converts to epoch before sending (or pass epoch directly). */
  date_due?: number | string | undefined;
  category_id?: number | undefined;
  score?: number | undefined;
  swimlane_id?: number | undefined;
  priority?: number | undefined;
  reference?: string | undefined;
  tags?: string[] | undefined;
  /** ISO 8601 string or epoch seconds. */
  date_started?: number | string | undefined;
}

export interface UpdateTaskInput {
  /**
   * Task id to update.
   *
   * Renamed from legacy `id` in v0.3.0 for naming uniformity. The handler
   * remaps this to the wire-level `id` Kanboard's JSON-RPC `updateTask`
   * method expects.
   */
  task_id: number;
  title?: string | undefined;
  description?: string | undefined;
  color_id?: string | undefined;
  owner_id?: number | undefined;
  creator_id?: number | undefined;
  date_due?: number | string | undefined;
  category_id?: number | undefined;
  score?: number | undefined;
  priority?: number | undefined;
  reference?: string | undefined;
  tags?: string[] | undefined;
  date_started?: number | string | undefined;
}

// ─── MyDashboard shape (composed from getMyDashboard) ─────────────────────

export interface MyDashboard {
  projects: Project[];
  tasks: Task[];
  subtasks: Subtask[];
}

// ─── Application version ───────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Private decoder helpers
// ---------------------------------------------------------------------------

/**
 * Decode a single-entity getter response.
 * - null → NotFoundError
 * - Zod fail → ValidationError
 * - success → typed entity
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function decodeGetSingle<T>(method: string, raw: unknown, schema: ZodTypeAny, logger: Logger): T {
  if (raw === null || raw === undefined) {
    throw new NotFoundError(method, `${method}: entity not found`);
  }

  const result = schema.safeParse(raw) as { success: true; data: T } | { success: false; error: ZodError };
  if (!result.success) {
    const msg = result.error.issues.map((i: ZodIssue) => i.message).join("; ");
    logger.warn({ method, error: msg }, "decodeGetSingle: Zod parse failed");
    throw new ValidationError(method, `${method}: response schema mismatch — ${msg}`, result.error.issues);
  }

  return result.data;
}

/**
 * Decode a list getter response.
 * - false → KanboardApiError (server-side list failure)
 * - array → parse each item; drop malformed, log warn
 * - empty array → return []
 */
function decodeGetList<T>(method: string, raw: unknown, schema: ZodTypeAny, logger: Logger): T[] {
  if (raw === false) {
    throw new KanboardApiError(method, `${method} failed (Kanboard returned false)`);
  }

  if (!Array.isArray(raw)) {
    throw new KanboardApiError(method, `${method}: expected array, got ${typeof raw}`);
  }

  const items: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = schema.safeParse(raw[i]) as { success: true; data: T } | { success: false; error: ZodError };
    if (result.success) {
      items.push(result.data);
    } else {
      const msg = result.error.issues.map((issue: ZodIssue) => issue.message).join("; ");
      logger.warn({ method, index: i, error: msg }, "decodeGetList: dropping malformed item");
    }
  }

  return items;
}

/**
 * Decode a mutation response.
 * - false → KanboardApiError
 * - number → returned as-is (e.g. new entity id)
 * - true → undefined (void success)
 */
function decodeMutation(method: string, raw: unknown): number | undefined {
  if (raw === false) {
    throw new KanboardApiError(
      method,
      `${method} failed (Kanboard returned false — pre-validate inputs)`,
    );
  }

  if (typeof raw === "number") {
    return raw;
  }

  if (raw === true) {
    return undefined;
  }

  // Kanboard sometimes returns a numeric string for create* methods
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!isNaN(n) && n > 0) return n;
  }

  throw new KanboardApiError(method, `${method}: unexpected mutation result: ${JSON.stringify(raw)}`);
}

// ---------------------------------------------------------------------------
// KanboardHandler
// ---------------------------------------------------------------------------

/**
 * Typed Kanboard JSON-RPC client.
 *
 * @example
 * ```ts
 * const handler = new KanboardHandler({ apiClient });
 * const projects = await handler.getMyProjects();
 * ```
 */
export class KanboardHandler {
  readonly #apiClient: ApiClient;
  readonly #logger: Logger;

  /**
   * Promise for the getMe() call initiated in the ctor.
   * Eager-but-non-fatal: ctor returns immediately; failure surfaces on first await.
   */
  #getMePromise: Promise<User>;

  public constructor(opts: KanboardHandlerOptions) {
    this.#apiClient = opts.apiClient;
    this.#logger = opts.logger ?? createLogger();
    // Kick off getMe eagerly — non-fatal at ctor time.
    this.#getMePromise = this.#initGetMe();
  }

  // ─── getMe cache ──────────────────────────────────────────────────────────

  /**
   * Private async method that fires the getMe RPC and caches the User.
   * Called once in ctor. On failure the rejected promise is held — it surfaces
   * as AuthError on the first `await getMe()` call.
   */
  async #initGetMe(): Promise<User> {
    try {
      const raw = await this.#apiClient.call("getMe", undefined);
      return UserSchema.parse(raw);
    } catch (err) {
      // Wrap as AuthError so callers get a clear error type.
      if (err instanceof AuthError) throw err;
      const wrapped = new AuthError(
        "getMe",
        `getMe() failed during initialization: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
      throw wrapped;
    }
  }

  /**
   * Returns the cached User from the `getMe` call initiated at construction.
   *
   * In `app` mode this resolves to the `jsonrpc` system user — comments authored
   * via `createComment` will show that user as author. Use `personal` mode for
   * human-attributed comments.
   *
   * @throws {AuthError} when the initial getMe call failed (wrong token, etc.)
   */
  public getMe(): Promise<User> {
    return this.#getMePromise;
  }

  /**
   * Convenience: returns only the numeric `id` of the current user.
   * @throws {AuthError} when getMe() fails.
   */
  public async getMeId(): Promise<number> {
    const user = await this.getMe();
    return user.id;
  }

  // ─── Health ───────────────────────────────────────────────────────────────

  /**
   * Returns the Kanboard server application version string.
   */
  public async getVersion(): Promise<string> {
    const raw = await this.#apiClient.call<unknown>("getVersion", undefined);

    this.#logger.debug({ method: "getVersion" }, "getVersion OK");

    if (typeof raw === "string") return raw;
    if (typeof raw === "object" && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if (typeof obj["application_version"] === "string") return obj["application_version"];
    }
    // Fallback: coerce to string for unknown shapes
    return JSON.stringify(raw);
  }

  // ─── Projects ─────────────────────────────────────────────────────────────

  /** Returns the projects where the calling user is a member. */
  public async getMyProjects(): Promise<Project[]> {
    const raw = await this.#apiClient.call("getMyProjects", undefined);
    this.#logger.debug({ method: "getMyProjects" }, "getMyProjects OK");
    return decodeGetList("getMyProjects", raw, ProjectSchema, this.#logger);
  }

  /**
   * Returns a project by numeric id.
   * @throws {NotFoundError} when the project does not exist.
   */
  public async getProjectById(projectId: number): Promise<Project> {
    const raw = await this.#apiClient.call("getProjectById", { project_id: projectId });
    this.#logger.debug({ method: "getProjectById" }, "getProjectById OK");
    return decodeGetSingle("getProjectById", raw, ProjectSchema, this.#logger);
  }

  /**
   * Returns a project by name.
   * @throws {NotFoundError} when not found.
   */
  public async getProjectByName(name: string): Promise<Project> {
    const raw = await this.#apiClient.call("getProjectByName", { name });
    this.#logger.debug({ method: "getProjectByName" }, "getProjectByName OK");
    return decodeGetSingle("getProjectByName", raw, ProjectSchema, this.#logger);
  }

  /**
   * Returns a project by its short identifier (e.g. "PRJ").
   * @throws {NotFoundError} when not found.
   */
  public async getProjectByIdentifier(identifier: string): Promise<Project> {
    const raw = await this.#apiClient.call("getProjectByIdentifier", { identifier });
    this.#logger.debug({ method: "getProjectByIdentifier" }, "getProjectByIdentifier OK");
    return decodeGetSingle("getProjectByIdentifier", raw, ProjectSchema, this.#logger);
  }

  /**
   * Creates a new project.
   * @returns The numeric `project_id` of the new project.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async createProject(input: {
    name: string;
    description?: string | undefined;
    identifier?: string | undefined;
    owner_id?: number | undefined;
    start_date?: number | string | undefined;
    end_date?: number | string | undefined;
    email?: string | undefined;
  }): Promise<number> {
    const raw = await this.#apiClient.call("createProject", input);
    this.#logger.debug({ method: "createProject" }, "createProject OK");
    const id = decodeMutation("createProject", raw);
    if (id === undefined) {
      throw new KanboardApiError("createProject", "createProject returned true but expected a project_id");
    }
    return id;
  }

  /**
   * Updates an existing project (partial update).
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async updateProject(input: {
    project_id: number;
    name?: string | undefined;
    description?: string | undefined;
    identifier?: string | undefined;
    owner_id?: number | undefined;
    start_date?: number | string | undefined;
    end_date?: number | string | undefined;
    email?: string | undefined;
  }): Promise<void> {
    const raw = await this.#apiClient.call("updateProject", input);
    this.#logger.debug({ method: "updateProject" }, "updateProject OK");
    decodeMutation("updateProject", raw);
  }

  /**
   * Adds a user to a project with the given role.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async addProjectUser(input: {
    project_id: number;
    user_id: number;
    role?: "project-manager" | "project-member" | "project-viewer" | undefined;
  }): Promise<void> {
    const params = {
      project_id: input.project_id,
      user_id: input.user_id,
      role: input.role ?? "project-member",
    };
    const raw = await this.#apiClient.call("addProjectUser", params);
    this.#logger.debug({ method: "addProjectUser" }, "addProjectUser OK");
    decodeMutation("addProjectUser", raw);
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────

  /**
   * Returns all tasks for a project, optionally filtered by status.
   * @param input.status_id 1 = active (default), 0 = inactive/closed.
   */
  public async getAllTasks(input: { project_id: number; status_id?: 0 | 1 | undefined }): Promise<Task[]> {
    const params = { project_id: input.project_id, status_id: input.status_id ?? 1 };
    const raw = await this.#apiClient.call("getAllTasks", params);
    this.#logger.debug({ method: "getAllTasks" }, "getAllTasks OK");
    return decodeGetList("getAllTasks", raw, TaskSchema, this.#logger);
  }

  /**
   * Returns a single task by id.
   * @throws {NotFoundError} when the task does not exist.
   */
  public async getTask(taskId: number): Promise<Task> {
    const raw = await this.#apiClient.call("getTask", { task_id: taskId });
    this.#logger.debug({ method: "getTask" }, "getTask OK");
    return decodeGetSingle("getTask", raw, TaskSchema, this.#logger);
  }

  /**
   * Creates a new task.
   * @returns The numeric `task_id` of the new task.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async createTask(input: CreateTaskInput): Promise<number> {
    const raw = await this.#apiClient.call("createTask", input);
    this.#logger.debug({ method: "createTask" }, "createTask OK");
    const id = decodeMutation("createTask", raw);
    if (id === undefined) {
      throw new KanboardApiError("createTask", "createTask returned true but expected a task_id");
    }
    return id;
  }

  /**
   * Updates an existing task (partial update).
   *
   * The MCP-facing input field is `task_id` (v0.3.0+); Kanboard's JSON-RPC
   * `updateTask` expects the wire param `id`, so we remap here at the
   * transport boundary.
   *
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async updateTask(input: UpdateTaskInput): Promise<void> {
    const { task_id, ...rest } = input;
    const raw = await this.#apiClient.call("updateTask", { id: task_id, ...rest });
    this.#logger.debug({ method: "updateTask" }, "updateTask OK");
    decodeMutation("updateTask", raw);
  }

  /**
   * Moves a task to a different column/position/swimlane.
   * All five params are required by the Kanboard API.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async moveTaskPosition(input: {
    project_id: number;
    task_id: number;
    column_id: number;
    position: number;
    swimlane_id: number;
  }): Promise<void> {
    const raw = await this.#apiClient.call("moveTaskPosition", input);
    this.#logger.debug({ method: "moveTaskPosition" }, "moveTaskPosition OK");
    decodeMutation("moveTaskPosition", raw);
  }

  /**
   * Search tasks in a project using Kanboard's advanced search syntax.
   * Example query: `"assignee:me status:open"`.
   */
  public async searchTasks(input: { project_id: number; query: string }): Promise<Task[]> {
    const raw = await this.#apiClient.call("searchTasks", input);
    this.#logger.debug({ method: "searchTasks" }, "searchTasks OK");
    return decodeGetList("searchTasks", raw, TaskSchema, this.#logger);
  }

  // ─── Personal ─────────────────────────────────────────────────────────────

  /**
   * Returns the current user's dashboard (projects, tasks, subtasks).
   * In `app` mode returns the `jsonrpc` system user's dashboard.
   */
  public async getMyDashboard(): Promise<MyDashboard> {
    const raw = await this.#apiClient.call<Record<string, unknown>>("getMyDashboard", undefined);
    this.#logger.debug({ method: "getMyDashboard" }, "getMyDashboard OK");

    const projects = decodeGetList<Project>("getMyDashboard.projects", raw["projects"] ?? [], ProjectSchema, this.#logger);
    const tasks = decodeGetList<Task>("getMyDashboard.tasks", raw["tasks"] ?? [], TaskSchema, this.#logger);
    const subtasks = decodeGetList<Subtask>("getMyDashboard.subtasks", raw["subtasks"] ?? [], SubtaskSchema, this.#logger);

    return { projects, tasks, subtasks };
  }

  /**
   * Returns tasks that are overdue for the current user.
   */
  public async getMyOverdueTasks(): Promise<Task[]> {
    const raw = await this.#apiClient.call("getMyOverdueTasks", undefined);
    this.#logger.debug({ method: "getMyOverdueTasks" }, "getMyOverdueTasks OK");
    return decodeGetList("getMyOverdueTasks", raw, TaskSchema, this.#logger);
  }

  /**
   * Returns all overdue tasks for a specific project.
   */
  public async getOverdueTasksByProject(projectId: number): Promise<Task[]> {
    const raw = await this.#apiClient.call("getOverdueTasksByProject", { project_id: projectId });
    this.#logger.debug({ method: "getOverdueTasksByProject" }, "getOverdueTasksByProject OK");
    return decodeGetList("getOverdueTasksByProject", raw, TaskSchema, this.#logger);
  }

  /**
   * Returns all overdue tasks across all projects (admin-level).
   */
  public async getOverdueTasks(): Promise<Task[]> {
    const raw = await this.#apiClient.call("getOverdueTasks", undefined);
    this.#logger.debug({ method: "getOverdueTasks" }, "getOverdueTasks OK");
    return decodeGetList("getOverdueTasks", raw, TaskSchema, this.#logger);
  }

  // ─── Batch task creation ──────────────────────────────────────────────────

  /**
   * Creates multiple tasks in a single JSON-RPC batch POST.
   *
   * Non-atomic: Kanboard does NOT wrap batch calls in a transaction — partial
   * failure is expected and reported in `failed[]`. This method NEVER throws on
   * partial failure; always returns the `{created, failed}` envelope.
   *
   * The caller MUST pre-validate that `items.length` is in the range `[0, BATCH_TASK_CAP]`.
   * This method also enforces the cap defensively.
   *
   * @param projectId - Project id applied to every task.
   * @param items - Array of task creation inputs.
   * @returns Envelope with `created[]` and `failed[]`, indexed by original input position.
   */
  public async createTasksBatch(
    projectId: number,
    items: BatchCreateTasksItem[],
  ): Promise<BatchCreateTasksResult> {
    if (items.length === 0) {
      return { created: [], failed: [] };
    }

    if (items.length > BATCH_TASK_CAP) {
      throw new ValidationError(
        "createTasksBatch",
        `createTasksBatch: items count ${String(items.length)} exceeds cap ${String(BATCH_TASK_CAP)}`,
      );
    }

    // Build batch calls — use index as the id for alignment.
    // Map id → original input index (index IS the id here, but we build
    // the map explicitly for clarity and future-proofing).
    const idToIndex = new Map<number, number>();
    const calls: BatchCall[] = items.map((item, index) => {
      idToIndex.set(index, index);
      return {
        method: "createTask",
        params: { project_id: projectId, ...item },
        id: index,
      };
    });

    this.#logger.debug({ method: "createTasksBatch", count: items.length }, "batch starting");

    const results = await this.#apiClient.batch(calls);

    const created: BatchCreateTasksResult["created"] = [];
    const failed: BatchCreateTasksResult["failed"] = [];

    for (const batchResult of results) {
      const originalIndex = idToIndex.get(batchResult.index) ?? batchResult.index;
      const item = items[originalIndex];
      const title = item?.title ?? "";

      if (batchResult.ok) {
        const raw = batchResult.result;
        // Result can be an integer task_id or false (Kanboard returns false in
        // the result field for some failure cases even in batch mode)
        if (raw === false) {
          failed.push({
            index: originalIndex,
            title,
            error: {
              code: "API_ERROR",
              message: "createTask returned false (pre-validate inputs)",
            },
          });
        } else if (typeof raw === "number" && raw > 0) {
          created.push({ index: originalIndex, task_id: raw, title });
        } else if (typeof raw === "string") {
          const n = Number(raw);
          if (!isNaN(n) && n > 0) {
            created.push({ index: originalIndex, task_id: n, title });
          } else {
            failed.push({
              index: originalIndex,
              title,
              error: { code: "API_ERROR", message: `Unexpected result: ${raw}` },
            });
          }
        } else {
          failed.push({
            index: originalIndex,
            title,
            error: { code: "API_ERROR", message: `Unexpected result type: ${typeof raw}` },
          });
        }
      } else {
        const err = batchResult.error;
        failed.push({
          index: originalIndex,
          title,
          error: {
            code: err.code < 0 ? "RPC_ERROR" : "API_ERROR",
            message: err.message,
          },
        });
      }
    }

    // Sort by original index for deterministic output
    created.sort((a, b) => a.index - b.index);
    failed.sort((a, b) => a.index - b.index);

    this.#logger.debug(
      { method: "createTasksBatch", createdCount: created.length, failedCount: failed.length },
      "batch complete",
    );

    return { created, failed };
  }

  // ─── Attachments ──────────────────────────────────────────────────────────

  /**
   * Uploads a base64-encoded file to a task.
   * @returns The numeric `file_id` of the created attachment.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async createTaskFile(input: {
    project_id: number;
    task_id: number;
    filename: string;
    blob_base64: string;
  }): Promise<number> {
    const params = {
      project_id: input.project_id,
      task_id: input.task_id,
      filename: input.filename,
      blob: input.blob_base64,
    };
    const raw = await this.#apiClient.call("createTaskFile", params);
    this.#logger.debug({ method: "createTaskFile" }, "createTaskFile OK");
    const id = decodeMutation("createTaskFile", raw);
    if (id === undefined) {
      throw new KanboardApiError("createTaskFile", "createTaskFile returned true but expected a file_id");
    }
    return id;
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  /**
   * Creates a comment on a task.
   *
   * The `user_id` is automatically injected from the cached `getMe()` result.
   * No need (and no way) to pass `user_id` from the tool layer.
   *
   * @throws {AuthError} when getMe() failed (wrong token).
   * @throws {KanboardApiError} when Kanboard returns false.
   * @returns The numeric `comment_id`.
   */
  public async createComment(input: {
    task_id: number;
    content: string;
    reference?: string | undefined;
    visibility?: "app-user" | "app-manager" | "app-admin" | undefined;
  }): Promise<number> {
    const me = await this.getMe();
    const params = {
      task_id: input.task_id,
      user_id: me.id,
      content: input.content,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    };
    const raw = await this.#apiClient.call("createComment", params);
    this.#logger.debug({ method: "createComment" }, "createComment OK");
    const id = decodeMutation("createComment", raw);
    if (id === undefined) {
      throw new KanboardApiError("createComment", "createComment returned true but expected a comment_id");
    }
    return id;
  }

  // ─── Subtasks ─────────────────────────────────────────────────────────────

  /**
   * Creates a subtask under a task.
   * @returns The numeric `subtask_id`.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async createSubtask(input: {
    task_id: number;
    title: string;
    user_id?: number | undefined;
    time_estimated?: number | undefined;
    time_spent?: number | undefined;
    status?: 0 | 1 | 2 | undefined;
  }): Promise<number> {
    const raw = await this.#apiClient.call("createSubtask", input);
    this.#logger.debug({ method: "createSubtask" }, "createSubtask OK");
    const id = decodeMutation("createSubtask", raw);
    if (id === undefined) {
      throw new KanboardApiError("createSubtask", "createSubtask returned true but expected a subtask_id");
    }
    return id;
  }

  /**
   * Updates an existing subtask (partial update).
   *
   * The MCP-facing input field is `subtask_id` (v0.3.0+); Kanboard's JSON-RPC
   * `updateSubtask` expects the wire param `id`, so we remap here at the
   * transport boundary.
   *
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async updateSubtask(input: {
    subtask_id: number;
    task_id: number;
    title?: string | undefined;
    status?: 0 | 1 | 2 | undefined;
    user_id?: number | undefined;
    time_estimated?: number | undefined;
    time_spent?: number | undefined;
  }): Promise<void> {
    const { subtask_id, ...rest } = input;
    const raw = await this.#apiClient.call("updateSubtask", { id: subtask_id, ...rest });
    this.#logger.debug({ method: "updateSubtask" }, "updateSubtask OK");
    decodeMutation("updateSubtask", raw);
  }

  /**
   * Returns all subtasks for a task.
   */
  public async getAllSubtasks(taskId: number): Promise<Subtask[]> {
    const raw = await this.#apiClient.call("getAllSubtasks", { task_id: taskId });
    this.#logger.debug({ method: "getAllSubtasks" }, "getAllSubtasks OK");
    return decodeGetList("getAllSubtasks", raw, SubtaskSchema, this.#logger);
  }

  // ─── Lookups ──────────────────────────────────────────────────────────────

  /**
   * Returns all columns for a project.
   */
  public async getColumns(projectId: number): Promise<Column[]> {
    const raw = await this.#apiClient.call("getColumns", { project_id: projectId });
    this.#logger.debug({ method: "getColumns" }, "getColumns OK");
    return decodeGetList("getColumns", raw, ColumnSchema, this.#logger);
  }

  /**
   * Returns a single column by id.
   * @throws {NotFoundError} when the column does not exist.
   */
  public async getColumn(columnId: number): Promise<Column> {
    const raw = await this.#apiClient.call("getColumn", { column_id: columnId });
    this.#logger.debug({ method: "getColumn" }, "getColumn OK");
    return decodeGetSingle("getColumn", raw, ColumnSchema, this.#logger);
  }

  /**
   * Adds a new column to a project board.
   * @returns The numeric `column_id` of the new column.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async addColumn(input: {
    project_id: number;
    title: string;
    task_limit?: number | undefined;
    description?: string | undefined;
  }): Promise<number> {
    const raw = await this.#apiClient.call("addColumn", input);
    this.#logger.debug({ method: "addColumn" }, "addColumn OK");
    const id = decodeMutation("addColumn", raw);
    if (id === undefined) {
      throw new KanboardApiError("addColumn", "addColumn returned true but expected a column_id");
    }
    return id;
  }

  /**
   * Updates an existing column (title, task_limit, description).
   * Kanboard's JSON-RPC `updateColumn` requires `title` to be present.
   * When the caller omits `title`, this method fetches the existing column
   * via `getColumn` and forwards its title — ensuring the wire payload is
   * always valid regardless of the call site (tool layer, integration test,
   * or any future programmatic consumer).
   * @throws {KanboardApiError} when Kanboard returns false.
   * @throws {NotFoundError} when the column does not exist (propagated from getColumn).
   */
  public async updateColumn(input: {
    column_id: number;
    title?: string | undefined;
    task_limit?: number | undefined;
    description?: string | undefined;
  }): Promise<void> {
    // Kanboard requires title on every updateColumn call.  Fetch the existing
    // title when the caller omits it so the wire payload is always valid.
    // `??` short-circuits: getColumn is NOT called when input.title is already defined.
    const resolvedTitle =
      input.title ?? (await this.getColumn(input.column_id)).title;

    const raw = await this.#apiClient.call("updateColumn", {
      ...input,
      title: resolvedTitle,
    });
    this.#logger.debug({ method: "updateColumn" }, "updateColumn OK");
    decodeMutation("updateColumn", raw);
  }

  /**
   * Moves a column to a new position on the board.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async changeColumnPosition(input: {
    project_id: number;
    column_id: number;
    position: number;
  }): Promise<void> {
    const raw = await this.#apiClient.call("changeColumnPosition", input);
    this.#logger.debug({ method: "changeColumnPosition" }, "changeColumnPosition OK");
    decodeMutation("changeColumnPosition", raw);
  }

  /**
   * Returns all categories for a project.
   */
  public async getAllCategories(projectId: number): Promise<Category[]> {
    const raw = await this.#apiClient.call("getAllCategories", { project_id: projectId });
    this.#logger.debug({ method: "getAllCategories" }, "getAllCategories OK");
    return decodeGetList("getAllCategories", raw, CategorySchema, this.#logger);
  }

  /**
   * Returns the members of a project (user_id + username pairs).
   *
   * Wraps Kanboard's `getProjectUsers(project_id)` which returns a sparse
   * `{ user_id: username }` dict. This method normalizes that into a typed
   * `ProjectMember[]` sorted by `user_id` for deterministic output.
   *
   * Available to any user who can see the project — does NOT require admin.
   * Replaces the v0.2.5 `getAllUsers()` method, which required `app-admin`
   * and broke for `app-manager` / `app-user` callers.
   *
   * @throws {KanboardApiError} when the underlying call fails or returns an
   *   unexpected shape.
   */
  public async getProjectUsers(projectId: number): Promise<ProjectMember[]> {
    const raw = await this.#apiClient.call("getProjectUsers", { project_id: projectId });
    this.#logger.debug({ method: "getProjectUsers", projectId }, "getProjectUsers OK");

    if (raw === false || raw === null || raw === undefined) {
      throw new KanboardApiError(
        "getProjectUsers",
        `getProjectUsers failed for project ${String(projectId)}`,
      );
    }

    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new KanboardApiError(
        "getProjectUsers",
        `getProjectUsers: expected dict, got ${Array.isArray(raw) ? "array" : typeof raw}`,
      );
    }

    const dict = raw as Record<string, unknown>;
    const members: ProjectMember[] = [];
    for (const [key, value] of Object.entries(dict)) {
      const userId = Number(key);
      if (!Number.isFinite(userId) || userId <= 0) {
        this.#logger.warn(
          { method: "getProjectUsers", projectId, key },
          "getProjectUsers: dropping malformed user_id key",
        );
        continue;
      }
      if (typeof value !== "string") {
        this.#logger.warn(
          { method: "getProjectUsers", projectId, key, valueType: typeof value },
          "getProjectUsers: dropping non-string username",
        );
        continue;
      }
      members.push({ user_id: userId, username: value });
    }

    members.sort((a, b) => a.user_id - b.user_id);
    return members;
  }

  /**
   * Returns active swimlanes for a project.
   * The default swimlane is included if enabled in project settings.
   */
  public async getActiveSwimlanes(projectId: number): Promise<Swimlane[]> {
    const raw = await this.#apiClient.call("getActiveSwimlanes", { project_id: projectId });
    this.#logger.debug({ method: "getActiveSwimlanes" }, "getActiveSwimlanes OK");
    return decodeGetList("getActiveSwimlanes", raw, SwimlaneSchema, this.#logger);
  }

  /**
   * Returns all swimlanes (including disabled) for a project.
   */
  public async getAllSwimlanes(projectId: number): Promise<Swimlane[]> {
    const raw = await this.#apiClient.call("getAllSwimlanes", { project_id: projectId });
    this.#logger.debug({ method: "getAllSwimlanes" }, "getAllSwimlanes OK");
    return decodeGetList("getAllSwimlanes", raw, SwimlaneSchema, this.#logger);
  }

  /**
   * Returns a single swimlane by id.
   * @throws {NotFoundError} when the swimlane does not exist.
   */
  public async getSwimlane(swimlaneId: number): Promise<Swimlane> {
    const raw = await this.#apiClient.call("getSwimlane", { swimlane_id: swimlaneId });
    this.#logger.debug({ method: "getSwimlane" }, "getSwimlane OK");
    return decodeGetSingle("getSwimlane", raw, SwimlaneSchema, this.#logger);
  }

  /**
   * Adds a new swimlane to a project.
   * @returns The numeric `swimlane_id` of the new swimlane.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async addSwimlane(input: {
    project_id: number;
    name: string;
    description?: string | undefined;
  }): Promise<number> {
    const raw = await this.#apiClient.call("addSwimlane", input);
    this.#logger.debug({ method: "addSwimlane" }, "addSwimlane OK");
    const id = decodeMutation("addSwimlane", raw);
    if (id === undefined) {
      throw new KanboardApiError("addSwimlane", "addSwimlane returned true but expected a swimlane_id");
    }
    return id;
  }

  /**
   * Updates an existing swimlane (partial — name and/or description).
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async updateSwimlane(input: {
    swimlane_id: number;
    name?: string | undefined;
    description?: string | undefined;
  }): Promise<void> {
    const raw = await this.#apiClient.call("updateSwimlane", input);
    this.#logger.debug({ method: "updateSwimlane" }, "updateSwimlane OK");
    decodeMutation("updateSwimlane", raw);
  }

  /**
   * Moves a swimlane to a new position within its project.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async changeSwimlanePosition(input: {
    project_id: number;
    swimlane_id: number;
    position: number;
  }): Promise<void> {
    const raw = await this.#apiClient.call("changeSwimlanePosition", input);
    this.#logger.debug({ method: "changeSwimlanePosition" }, "changeSwimlanePosition OK");
    decodeMutation("changeSwimlanePosition", raw);
  }

  /**
   * Removes a swimlane from a project.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async removeSwimlane(input: {
    project_id: number;
    swimlane_id: number;
  }): Promise<void> {
    const raw = await this.#apiClient.call("removeSwimlane", input);
    this.#logger.debug({ method: "removeSwimlane" }, "removeSwimlane OK");
    decodeMutation("removeSwimlane", raw);
  }

  // ─── Destructive operations ───────────────────────────────────────────────

  /**
   * Permanently removes a task.
   * The wire param Kanboard expects is `task_id`.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async removeTask(taskId: number): Promise<void> {
    const raw = await this.#apiClient.call("removeTask", { task_id: taskId });
    this.#logger.debug({ method: "removeTask" }, "removeTask OK");
    decodeMutation("removeTask", raw);
  }

  /**
   * Permanently removes a project (and every entity inside it).
   * The wire param Kanboard expects is `project_id`.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async removeProject(projectId: number): Promise<void> {
    const raw = await this.#apiClient.call("removeProject", { project_id: projectId });
    this.#logger.debug({ method: "removeProject" }, "removeProject OK");
    decodeMutation("removeProject", raw);
  }

  /**
   * Permanently removes a subtask.
   * Kanboard's wire param for this method is `subtask_id`.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async removeSubtask(subtaskId: number): Promise<void> {
    const raw = await this.#apiClient.call("removeSubtask", { subtask_id: subtaskId });
    this.#logger.debug({ method: "removeSubtask" }, "removeSubtask OK");
    decodeMutation("removeSubtask", raw);
  }

  /**
   * Permanently removes a comment.
   * Kanboard's wire param for this method is `comment_id`.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async removeComment(commentId: number): Promise<void> {
    const raw = await this.#apiClient.call("removeComment", { comment_id: commentId });
    this.#logger.debug({ method: "removeComment" }, "removeComment OK");
    decodeMutation("removeComment", raw);
  }

  /**
   * Permanently removes a task attachment (file).
   * Kanboard's wire param for this method is `file_id`.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async removeTaskFile(fileId: number): Promise<void> {
    const raw = await this.#apiClient.call("removeTaskFile", { file_id: fileId });
    this.#logger.debug({ method: "removeTaskFile" }, "removeTaskFile OK");
    decodeMutation("removeTaskFile", raw);
  }

  /**
   * Removes the link between a user and a project.
   * Kanboard's wire params are `project_id` and `user_id`.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async removeProjectUser(input: {
    project_id: number;
    user_id: number;
  }): Promise<void> {
    const raw = await this.#apiClient.call("removeProjectUser", input);
    this.#logger.debug({ method: "removeProjectUser" }, "removeProjectUser OK");
    decodeMutation("removeProjectUser", raw);
  }

  // ─── Comment update ───────────────────────────────────────────────────────

  /**
   * Updates the body of an existing comment.
   * Kanboard's wire params are `id` (the comment id) and `content`.
   * The MCP tool layer accepts `comment_id` and remaps to wire `id` here.
   * @throws {KanboardApiError} when Kanboard returns false.
   */
  public async updateComment(input: {
    comment_id: number;
    content: string;
  }): Promise<void> {
    const raw = await this.#apiClient.call("updateComment", {
      id: input.comment_id,
      content: input.content,
    });
    this.#logger.debug({ method: "updateComment" }, "updateComment OK");
    decodeMutation("updateComment", raw);
  }

  // ─── Task close (Phase 9 board hygiene) ───────────────────────────────────

  /**
   * Closes a task (sets `is_active` to 0 in Kanboard).
   *
   * Phase 9 board-hygiene helper for v0.3.0: closes stale-but-done cards
   * left in the Erledigt column with `status: 1`. Kanboard exposes a dedicated
   * `closeTask` JSON-RPC method on standard installs — this handler attempts
   * it directly. If the deployment lacks `closeTask`, callers may fall back to
   * `updateTask({ task_id, status: false })` (a separate code path is provided
   * at the tool/script layer when this method is unavailable).
   *
   * Wire param is `task_id`.
   * @throws {KanboardApiError} when Kanboard returns false (e.g. method not exposed).
   */
  public async closeTask(taskId: number): Promise<void> {
    const raw = await this.#apiClient.call("closeTask", { task_id: taskId });
    this.#logger.debug({ method: "closeTask" }, "closeTask OK");
    decodeMutation("closeTask", raw);
  }
}
