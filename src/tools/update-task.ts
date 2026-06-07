/**
 * update_task — Update an existing Kanboard task (partial update).
 *
 * At least one updatable field beyond `task_id` must be provided.
 * Cross-field validation runs in the handler (NOT in the schema) so that
 * inputSchema remains a plain ZodObject — the MCP SDK only reads ZodObject.shape.
 * Column and swimlane changes must go through move_task_position.
 * Returns { ok: true } on success.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { isoToEpoch } from "../schemas/dates.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Updatable fields (excludes id, column_id, swimlane_id per spec FR-10)
// ---------------------------------------------------------------------------

const UPDATABLE_FIELDS = [
  "title",
  "description",
  "color_id",
  "owner_id",
  "creator_id",
  "date_due",
  "category_id",
  "score",
  "priority",
  "reference",
  "tags",
  "date_started",
] as const;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

// NOTE: Do NOT add top-level .refine() to this schema. The MCP SDK
// normalizeObjectSchema() only reads ZodObject.shape; a top-level .refine()
// produces ZodEffects which has no .shape and collapses tools/list to {}.
// Cross-field validation belongs in the handler body instead.
export const UpdateTaskInput = z
  .object({
    task_id: z.number().int().positive().describe("Task id to update (required)."),
    title: z.string().min(1).max(255).optional().describe("New task title."),
    description: z.string().optional().describe("New task description."),
    color_id: z.string().optional().describe("New color identifier (e.g. 'blue', 'red')."),
    owner_id: z.number().int().positive().optional().describe("New owner user id."),
    creator_id: z.number().int().positive().optional().describe("New creator user id."),
    date_due: z.union([z.string(), z.number().int(), z.null()]).optional().describe("New due date as ISO 8601 string, Unix epoch seconds (integer), or null to clear."),
    category_id: z.number().int().positive().optional().describe("New category id."),
    score: z.number().int().optional().describe("New complexity score."),
    priority: z.number().int().optional().describe("New priority."),
    reference: z.string().optional().describe("New external reference (e.g. issue URL)."),
    tags: z.array(z.string()).optional().describe("New array of tag strings (replaces existing)."),
    date_started: z.union([z.string(), z.number().int(), z.null()]).optional().describe("New start date as ISO 8601 string, Unix epoch seconds (integer), or null to clear."),
  })
  .strict();

export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

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

interface UpdateTaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; task_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const updateTaskTool = {
  name: "update_task",
  description:
    "Update the attributes of an existing Kanboard task (partial update). " +
    "Only the fields you pass are changed; omitted fields keep their current values, " +
    "and validation runs before any write, so an invalid call modifies nothing. " +
    "At least one field besides 'task_id' must be provided — otherwise VALIDATION_ERROR. " +
    "Column and swimlane changes must use move_task_position instead. " +
    "Returns { ok: true, task_id } on success.",
  inputSchema: UpdateTaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<UpdateTaskResult> => {
    const parsed = UpdateTaskInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "update_task",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    if (!UPDATABLE_FIELDS.some((field) => input[field] !== undefined)) {
      throw new ValidationError(
        "update_task",
        "At least one updatable field is required (title, description, color_id, owner_id, creator_id, date_due, category_id, score, priority, reference, tags, or date_started).",
        { provided_fields: Object.keys(input) },
      );
    }

    await deps.handler.updateTask({
      task_id: input.task_id,
      title: input.title,
      description: input.description,
      color_id: input.color_id,
      owner_id: input.owner_id,
      creator_id: input.creator_id,
      date_due: isoToEpoch(input.date_due, "date_due") ?? undefined,
      category_id: input.category_id,
      score: input.score,
      priority: input.priority,
      reference: input.reference,
      tags: input.tags,
      date_started: isoToEpoch(input.date_started, "date_started") ?? undefined,
    });

    return {
      content: [{ type: "text", text: `Task ${String(input.task_id)} updated successfully.` }],
      structuredContent: { ok: true, task_id: input.task_id },
    };
  },
};
