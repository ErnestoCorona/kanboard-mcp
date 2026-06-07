/**
 * update_subtask — Update an existing Kanboard subtask (partial update).
 *
 * FR-18: Wraps handler.updateSubtask(input).
 * Requires subtask_id + task_id (identity fields) plus at least one updatable field.
 * Cross-field validation runs in the handler (NOT in the schema) so that
 * inputSchema remains a plain ZodObject — the MCP SDK only reads ZodObject.shape.
 * Mutation returning false → API_ERROR (propagated from handler).
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

// NOTE: Do NOT add top-level .refine() to this schema. The MCP SDK
// normalizeObjectSchema() only reads ZodObject.shape; a top-level .refine()
// produces ZodEffects which has no .shape and collapses tools/list to {}.
// Cross-field validation belongs in the handler body instead.
export const UpdateSubtaskInput = z
  .object({
    subtask_id: z.number().int().positive().describe("ID of the subtask to update (required)."),
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
  .strict();

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
    "Only the fields you pass are changed; omitted fields keep their current values, " +
    "and validation runs before any write, so an invalid call modifies nothing. " +
    "Both 'subtask_id' and 'task_id' are required as identity fields. " +
    "At least one of title, status, user_id, time_estimated, or time_spent must also be provided. " +
    "Status: 0 = todo, 1 = in progress, 2 = done. " +
    "Returns { subtask_id, task_id } on success.",
  inputSchema: UpdateSubtaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<UpdateSubtaskResult> => {
    const parsed = UpdateSubtaskInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "update_subtask",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    if (
      input.title === undefined &&
      input.status === undefined &&
      input.user_id === undefined &&
      input.time_estimated === undefined &&
      input.time_spent === undefined
    ) {
      throw new ValidationError(
        "update_subtask",
        "At least one updatable field must be provided (title, status, user_id, time_estimated, or time_spent).",
        { provided_fields: Object.keys(input) },
      );
    }

    await deps.handler.updateSubtask({
      subtask_id: input.subtask_id,
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
          text: `Subtask ${String(input.subtask_id)} updated.`,
        },
      ],
      structuredContent: { subtask_id: input.subtask_id, task_id: input.task_id },
    };
  },
};
