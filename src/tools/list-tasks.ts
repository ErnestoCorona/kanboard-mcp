/**
 * list_tasks — List tasks in a Kanboard project.
 *
 * Resolves project context from .kanboard.yaml or explicit args.
 * Returns active tasks by default (status_id=1). Pass status_id=0 for closed/inactive.
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Task } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListTasksInput = z
  .object({
    project_id: z.number().int().positive().optional().describe("Kanboard project id (overrides .kanboard.yaml)."),
    project_identifier: z.string().optional().describe("Kanboard project identifier string (overrides .kanboard.yaml)."),
    status_id: z.union([z.literal(0), z.literal(1)]).default(1).describe("Task status: 1 = active (default), 0 = closed/inactive."),
  })
  .strict();

export type ListTasksInput = z.infer<typeof ListTasksInput>;

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

interface ListTasksResult {
  content: { type: "text"; text: string }[];
  structuredContent: { tasks: Task[]; project_id: number; status_id: 0 | 1 };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const listTasksTool = {
  name: "list_tasks",
  description:
    "List tasks in a Kanboard project. Returns active tasks by default (status_id=1). " +
    "Pass status_id=0 to list closed/inactive tasks. " +
    "Project is resolved from explicit project_id or project_identifier, or from .kanboard.yaml.",
  inputSchema: ListTasksInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListTasksResult> => {
    const input = ListTasksInput.parse(raw);

    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined ? { explicitProjectIdentifier: input.project_identifier } : {}),
    });

    const tasks = await deps.handler.getAllTasks({
      project_id: ctx.projectId,
      status_id: input.status_id,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
      structuredContent: { tasks, project_id: ctx.projectId, status_id: input.status_id },
    };
  },
};
