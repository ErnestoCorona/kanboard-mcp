/**
 * create_subtask — Create a subtask under a Kanboard task.
 *
 * FR-17: Wraps handler.createSubtask(input).
 * Returns { subtask_id } on success.
 * Mutation returning false → API_ERROR (propagated from handler).
 */

import { z } from "zod";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const CreateSubtaskInput = z
  .object({
    task_id: z.number().int().positive().describe("ID of the parent task."),
    title: z.string().min(1).max(255).describe("Subtask title (1–255 characters, required)."),
    user_id: z.number().int().positive().optional().describe("User id to assign the subtask to (optional)."),
    time_estimated: z.number().nonnegative().optional().describe("Estimated time in hours (optional)."),
    time_spent: z.number().nonnegative().optional().describe("Time already spent in hours (optional)."),
    status: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .optional()
      .describe("Subtask status: 0 = todo (default), 1 = in progress, 2 = done."),
  })
  .strict();

export type CreateSubtaskInput = z.infer<typeof CreateSubtaskInput>;

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

interface CreateSubtaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: { subtask_id: number; task_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const createSubtaskTool = {
  name: "create_subtask",
  description:
    "Create a subtask under an existing Kanboard task. " +
    "Returns { subtask_id } on success. " +
    "Status: 0 = todo (default), 1 = in progress, 2 = done.",
  inputSchema: CreateSubtaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<CreateSubtaskResult> => {
    const input = CreateSubtaskInput.parse(raw);

    const subtask_id = await deps.handler.createSubtask({
      task_id: input.task_id,
      title: input.title,
      ...(input.user_id !== undefined ? { user_id: input.user_id } : {}),
      ...(input.time_estimated !== undefined ? { time_estimated: input.time_estimated } : {}),
      ...(input.time_spent !== undefined ? { time_spent: input.time_spent } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });

    return {
      content: [
        {
          type: "text",
          text: `Subtask ${String(subtask_id)} created under task ${String(input.task_id)}.`,
        },
      ],
      structuredContent: { subtask_id, task_id: input.task_id },
    };
  },
};
