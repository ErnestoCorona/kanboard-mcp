/**
 * update_subtask — Update an existing Kanboard subtask (partial update).
 *
 * FR-18: Wraps handler.updateSubtask(input).
 * Requires id + task_id (identity fields) plus at least one updatable field.
 * Mutation returning false → API_ERROR (propagated from handler).
 */

import { z } from "zod";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const UpdateSubtaskInput = z
  .object({
    id: z.number().int().positive().describe("ID of the subtask to update (required)."),
    task_id: z.number().int().positive().describe("ID of the parent task (required)."),
    title: z.string().min(1).max(255).optional().describe("New subtask title (optional)."),
    status: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .optional()
      .describe("New status: 0 = todo, 1 = in progress, 2 = done (optional)."),
    user_id: z.number().int().positive().optional().describe("New assigned user id (optional)."),
    time_estimated: z.number().nonnegative().optional().describe("New estimated time in hours (optional)."),
    time_spent: z.number().nonnegative().optional().describe("New time spent in hours (optional)."),
  })
  .strict()
  .refine(
    (d) =>
      d.title !== undefined ||
      d.status !== undefined ||
      d.user_id !== undefined ||
      d.time_estimated !== undefined ||
      d.time_spent !== undefined,
    {
      message:
        "At least one updatable field must be provided (title, status, user_id, time_estimated, or time_spent).",
      path: ["title"],
    },
  );

export type UpdateSubtaskInput = z.infer<typeof UpdateSubtaskInput>;

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

interface UpdateSubtaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: { subtask_id: number; task_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const updateSubtaskTool = {
  name: "update_subtask",
  description:
    "Update an existing Kanboard subtask (partial update). " +
    "Both 'id' and 'task_id' are required as identity fields. " +
    "At least one of title, status, user_id, time_estimated, or time_spent must also be provided. " +
    "Status: 0 = todo, 1 = in progress, 2 = done.",
  inputSchema: UpdateSubtaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<UpdateSubtaskResult> => {
    const input = UpdateSubtaskInput.parse(raw);

    await deps.handler.updateSubtask({
      id: input.id,
      task_id: input.task_id,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.user_id !== undefined ? { user_id: input.user_id } : {}),
      ...(input.time_estimated !== undefined ? { time_estimated: input.time_estimated } : {}),
      ...(input.time_spent !== undefined ? { time_spent: input.time_spent } : {}),
    });

    return {
      content: [
        {
          type: "text",
          text: `Subtask ${String(input.id)} updated.`,
        },
      ],
      structuredContent: { subtask_id: input.id, task_id: input.task_id },
    };
  },
};
