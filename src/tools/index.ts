/**
 * MCP tool registration barrel — `src/tools/index.ts`
 *
 * Imports all 25 Kanboard tool objects, re-exports them individually,
 * and exposes:
 *   - `allTools`       — ordered, read-only array of every tool definition
 *   - `registerTools`  — mounts all 25 tools on an `McpServer` instance
 *
 * Call `registerTools` once during server bootstrap after constructing the
 * handler bundle via `createHandler(config)`.
 *
 * @example
 * ```ts
 * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 * import { createHandler } from "./handler/index.js";
 * import { registerTools } from "./tools/index.js";
 *
 * const { handler, resolvers } = createHandler(config);
 * const server = new McpServer({ name: "kanboard-mcp", version: "0.1.0" });
 * registerTools(server, { handler, resolvers });
 * await server.connect(transport);
 * ```
 */

import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodTypeAny } from "zod";
import type pino from "pino";

import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Tool imports (alphabetical by tool name for stability)
// ---------------------------------------------------------------------------

import { addCommentTool } from "./add-comment.js";
import { addProjectUserTool } from "./add-project-user.js";
import { attachFileToTaskTool } from "./attach-file-to-task.js";
import { createColumnTool } from "./create-column.js";
import { createProjectTool } from "./create-project.js";
import { createSubtaskTool } from "./create-subtask.js";
import { createTaskTool } from "./create-task.js";
import { createTasksBatchTool } from "./create-tasks-batch.js";
import { getProjectTool } from "./get-project.js";
import { getTaskTool } from "./get-task.js";
import { listCategoriesTool } from "./list-categories.js";
import { listColumnsTool } from "./list-columns.js";
import { listMyTasksTool } from "./list-my-tasks.js";
import { listOverdueTasksTool } from "./list-overdue-tasks.js";
import { listProjectsTool } from "./list-projects.js";
import { listSubtasksTool } from "./list-subtasks.js";
import { listSwimlanesTool } from "./list-swimlanes.js";
import { listTasksTool } from "./list-tasks.js";
import { listProjectUsersTool } from "./list-project-users.js";
import { moveColumnTool } from "./move-column.js";
import { moveTaskPositionTool } from "./move-task-position.js";
import { updateColumnTool } from "./update-column.js";
import { updateProjectTool } from "./update-project.js";
import { updateSubtaskTool } from "./update-subtask.js";
import { updateTaskTool } from "./update-task.js";

// ---------------------------------------------------------------------------
// Re-exports — individual tools (transports may pick them selectively)
// ---------------------------------------------------------------------------

export { addCommentTool } from "./add-comment.js";
export { addProjectUserTool } from "./add-project-user.js";
export { attachFileToTaskTool } from "./attach-file-to-task.js";
export { createColumnTool } from "./create-column.js";
export { createProjectTool } from "./create-project.js";
export { createSubtaskTool } from "./create-subtask.js";
export { createTaskTool } from "./create-task.js";
export { createTasksBatchTool } from "./create-tasks-batch.js";
export { getProjectTool } from "./get-project.js";
export { getTaskTool } from "./get-task.js";
export { listCategoriesTool } from "./list-categories.js";
export { listColumnsTool } from "./list-columns.js";
export { listMyTasksTool } from "./list-my-tasks.js";
export { listOverdueTasksTool } from "./list-overdue-tasks.js";
export { listProjectsTool } from "./list-projects.js";
export { listSubtasksTool } from "./list-subtasks.js";
export { listSwimlanesTool } from "./list-swimlanes.js";
export { listTasksTool } from "./list-tasks.js";
export { listProjectUsersTool } from "./list-project-users.js";
export { moveColumnTool } from "./move-column.js";
export { moveTaskPositionTool } from "./move-task-position.js";
export { updateColumnTool } from "./update-column.js";
export { updateProjectTool } from "./update-project.js";
export { updateSubtaskTool } from "./update-subtask.js";
export { updateTaskTool } from "./update-task.js";

// ---------------------------------------------------------------------------
// Shared deps interface — used by transports to wire everything together
// ---------------------------------------------------------------------------

/**
 * Runtime dependencies required by every tool handler.
 *
 * `logger` is optional; tools that need logging should accept it defensively.
 */
export interface ToolDeps {
  handler: KanboardHandler;
  resolvers: Resolvers;
  logger?: pino.Logger;
}

// ---------------------------------------------------------------------------
// ToolDef — canonical shape of every tool object in this project
// ---------------------------------------------------------------------------

/**
 * Canonical shape every tool object exported from `src/tools/<name>.ts` must
 * conform to. The `handler` signature uses `unknown` for the result so that
 * the registration loop is agnostic to each tool's concrete return type — the
 * MCP SDK handles serialisation.
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  handler: (raw: unknown, deps: ToolDeps) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// allTools — ordered registry
// ---------------------------------------------------------------------------

/**
 * All 25 Kanboard MCP tools in alphabetical order.
 *
 * Order is fixed so that any slice/comparison in tests and transports is
 * deterministic across environments.
 */
export const allTools: readonly ToolDef[] = [
  addCommentTool,
  addProjectUserTool,
  attachFileToTaskTool,
  createColumnTool,
  createProjectTool,
  createSubtaskTool,
  createTaskTool,
  createTasksBatchTool,
  getProjectTool,
  getTaskTool,
  listCategoriesTool,
  listColumnsTool,
  listMyTasksTool,
  listOverdueTasksTool,
  listProjectsTool,
  listSubtasksTool,
  listSwimlanesTool,
  listTasksTool,
  listProjectUsersTool,
  moveColumnTool,
  moveTaskPositionTool,
  updateColumnTool,
  updateProjectTool,
  updateSubtaskTool,
  updateTaskTool,
] as const;

// ---------------------------------------------------------------------------
// registerTools — mount all tools on the MCP server
// ---------------------------------------------------------------------------

/**
 * Register all 25 Kanboard tools on a given `McpServer` instance.
 *
 * Each tool is attached via `server.registerTool(name, config, callback)`.
 * The SDK validates incoming input against the tool's Zod `inputSchema`
 * before the callback is invoked, so the tool handler receives already-parsed
 * args — but we pass the raw record through `tool.handler(args, deps)` which
 * re-validates internally for belt-and-suspenders safety.
 *
 * @param server - The `McpServer` instance to register tools on.
 * @param deps   - Shared tool dependencies (handler, resolvers, optional logger).
 */
export function registerTools(server: McpServer, deps: ToolDeps): void {
  for (const tool of allTools) {
    // Cast: each tool handler returns a `{ content, structuredContent }` object
    // that satisfies `CallToolResult`. We use `unknown` in `ToolDef.handler` to
    // keep the per-tool return types encapsulated, so we cast here at the
    // registration boundary where the MCP SDK takes ownership.
    const cb = ((args: Record<string, unknown>) =>
      tool.handler(args, deps)) as unknown as ToolCallback;

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      cb,
    );
  }
}

// ---------------------------------------------------------------------------
// Type utilities (re-exported for downstream use)
// ---------------------------------------------------------------------------

export type { CallToolResult };
