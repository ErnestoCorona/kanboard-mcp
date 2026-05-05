/**
 * list_my_tasks — List open tasks assigned to the current user in a project.
 *
 * FR-12: Wraps handler.searchTasks(project_id, "assignee:me status:open").
 * Project context is resolved via the standard precedence chain:
 *   explicit project_id > explicit project_identifier > .kanboard.yaml > ConfigError
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Task } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListMyTasksInput = z
  .object({
    project_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Kanboard project id (overrides .kanboard.yaml)."),
    project_identifier: z
      .string()
      .optional()
      .describe("Kanboard project identifier string (overrides .kanboard.yaml)."),
  })
  .strict();

export type ListMyTasksInput = z.infer<typeof ListMyTasksInput>;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface ToolDeps {
  handler: KanboardHandler;
  resolvers: Resolvers;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface ListMyTasksResult {
  content: { type: "text"; text: string }[];
  structuredContent: { tasks: Task[] };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const listMyTasksTool = {
  name: "list_my_tasks",
  description:
    "List open tasks assigned to the currently authenticated user in the resolved project. " +
    "Requires a project_id (explicit or from .kanboard.yaml). " +
    "Uses Kanboard search query: assignee:me status:open. " +
    "In app mode (jsonrpc user) returns tasks assigned to the jsonrpc system user.",
  inputSchema: ListMyTasksInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListMyTasksResult> => {
    const input = ListMyTasksInput.parse(raw);

    // ── 1. Resolve project context ────────────────────────────────────────────
    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined
        ? { explicitProjectIdentifier: input.project_identifier }
        : {}),
    });

    // ── 2. Search for tasks assigned to me, open ──────────────────────────────
    const tasks = await deps.handler.searchTasks({
      project_id: ctx.projectId,
      query: "assignee:me status:open",
    });

    const structuredContent = { tasks };

    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  },
};
