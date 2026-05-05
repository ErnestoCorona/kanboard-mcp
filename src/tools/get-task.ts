/**
 * get_task — Retrieve a single Kanboard task by id.
 *
 * Returns the full task entity. Throws NOT_FOUND when the task does not exist.
 */

import { z } from "zod";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Task } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const GetTaskInput = z
  .object({
    task_id: z.number().int().positive().describe("The task id to retrieve (must be a positive integer)."),
  })
  .strict();

export type GetTaskInput = z.infer<typeof GetTaskInput>;

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

interface GetTaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: Task;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const getTaskTool = {
  name: "get_task",
  description:
    "Retrieve a single Kanboard task by its numeric id. " +
    "Returns the full task entity including status, dates, column, swimlane, and metadata. " +
    "Returns NOT_FOUND when the task does not exist.",
  inputSchema: GetTaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<GetTaskResult> => {
    const input = GetTaskInput.parse(raw);
    const task = await deps.handler.getTask(input.task_id);

    return {
      content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      structuredContent: task,
    };
  },
};
