/**
 * update_column — Update an existing Kanboard column (partial update).
 *
 * FR-26: wraps handler.getColumn(column_id) + handler.updateColumn(input).
 * At least one updatable field besides column_id must be provided (Zod refine).
 * On success, resolver cache is invalidated (NFR-9) using project_id from getColumn.
 * Returns { ok: true, column_id } on success.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Updatable fields (excludes column_id per spec FR-26)
// ---------------------------------------------------------------------------

const UPDATABLE_FIELDS = ["title", "task_limit", "description"] as const;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const UpdateColumnInput = z
  .object({
    column_id: z.number().int().positive().describe("Column id to update (required)."),
    title: z.string().min(1).max(255).optional().describe("New column title (1–255 chars)."),
    task_limit: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("New WIP limit (0 = unlimited). Omit to leave unchanged."),
    description: z.string().optional().describe("New column description."),
  })
  .strict()
  .refine(
    (data) => UPDATABLE_FIELDS.some((field) => data[field] !== undefined),
    {
      message:
        "At least one updatable field is required (title, task_limit, or description).",
    },
  );

export type UpdateColumnInput = z.infer<typeof UpdateColumnInput>;

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

interface UpdateColumnResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; column_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const updateColumnTool = {
  name: "update_column",
  description:
    "Update an existing Kanboard column (partial update). " +
    "At least one field besides 'column_id' must be provided — otherwise VALIDATION_ERROR. " +
    "NOT for reordering — use move_column instead. " +
    "Returns { ok: true } on success.",
  inputSchema: UpdateColumnInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<UpdateColumnResult> => {
    const parsed = UpdateColumnInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "update_column",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    // Resolve project_id via getColumn — needed for resolver invalidation (NFR-9).
    // If column does not exist, NotFoundError propagates as-is.
    // Title-fallback (Kanboard requires title on every updateColumn call) now lives
    // in the handler layer (KanboardHandler.updateColumn) so any caller — tool,
    // integration test, or future consumer — gets correct wire output automatically.
    const column = await deps.handler.getColumn(input.column_id);

    // Perform the update — if it throws, do NOT invalidate (mutation didn't happen).
    await deps.handler.updateColumn({
      column_id: input.column_id,
      title: input.title,
      task_limit: input.task_limit,
      description: input.description,
    });

    // NFR-9: invalidate resolver cache on success — column title/structure changed.
    deps.resolvers.invalidate(column.project_id);

    return {
      content: [{ type: "text", text: `Column ${String(input.column_id)} updated successfully.` }],
      structuredContent: { ok: true, column_id: input.column_id },
    };
  },
};
