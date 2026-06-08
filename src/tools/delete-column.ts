/**
 * delete_column — Permanently delete a Kanboard column (destructive).
 *
 * Confirm-gated: caller MUST pass `confirm: true`. Zod's `z.literal(true)`
 * rejects missing/false at parse-time; `assertConfirmed` is a defensive
 * second check inside the handler.
 *
 * Project_id is derived from getColumn — needed for resolver invalidation
 * (NFR-9). Mirrors delete_swimlane's getSwimlane → removeSwimlane → invalidate
 * pattern.
 *
 * On success: returns `{ ok: true, column_id }`.
 * Errors propagate unchanged: NotFoundError (missing column), KanboardApiError
 * (Kanboard JSON-RPC failure), ValidationError (Zod or confirm gate).
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { assertConfirmed } from "../shared/confirm.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const DeleteColumnInput = z
  .object({
    column_id: z
      .number()
      .int()
      .positive()
      .describe("Column id to permanently delete (required)."),
    confirm: z
      .literal(true)
      .describe("Must be exactly `true` to confirm permanent deletion."),
  })
  .strict();

export type DeleteColumnInput = z.infer<typeof DeleteColumnInput>;

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

interface DeleteColumnResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; column_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const deleteColumnTool = {
  name: "delete_column",
  description:
    "Permanently delete a Kanboard column from a project board. DESTRUCTIVE and irreversible — requires explicit `confirm: true`. " +
    "To rename a column or change its WIP limit use update_column; to reorder it use move_column. " +
    "Returns { ok: true, column_id } on success.",
  inputSchema: DeleteColumnInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<DeleteColumnResult> => {
    const parsed = DeleteColumnInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "delete_column",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;
    assertConfirmed("delete_column", input.confirm);

    // Resolve project_id via getColumn — needed for resolver invalidation (NFR-9).
    // If column does not exist, NotFoundError propagates as-is.
    const column = await deps.handler.getColumn(input.column_id);

    await deps.handler.removeColumn(input.column_id);

    // NFR-9: invalidate resolver cache on success — column structure changed.
    deps.resolvers.invalidate(column.project_id);

    return {
      content: [
        { type: "text", text: `Column ${String(input.column_id)} deleted permanently.` },
      ],
      structuredContent: { ok: true, column_id: input.column_id },
    };
  },
};
