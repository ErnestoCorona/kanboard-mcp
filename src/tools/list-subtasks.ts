/**
 * list_subtasks — List all subtasks for a Kanboard task.
 *
 * FR-19: Wraps handler.getAllSubtasks(task_id).
 * Returns the array of subtasks directly.
 * list returning false → API_ERROR (propagated from handler).
 */

import { z } from "zod";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Subtask } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListSubtasksInput = z
  .object({
    task_id: z.number().int().positive().describe("ID of the task whose subtasks to list."),
  })
  .strict();

export type ListSubtasksInput = z.infer<typeof ListSubtasksInput>;

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

interface ListSubtasksResult {
  content: { type: "text"; text: string }[];
  structuredContent: { subtasks: Subtask[]; task_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const listSubtasksTool = {
  name: "list_subtasks",
  description:
    "List all subtasks for a given Kanboard task. " +
    "Returns an array of subtask objects including id, title, status, user_id, " +
    "time_estimated, and time_spent fields.",
  inputSchema: ListSubtasksInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListSubtasksResult> => {
    const input = ListSubtasksInput.parse(raw);

    const subtasks = await deps.handler.getAllSubtasks(input.task_id);

    return {
      content: [{ type: "text", text: JSON.stringify(subtasks, null, 2) }],
      structuredContent: { subtasks, task_id: input.task_id },
    };
  },
};
