/**
 * move_column — Reorder a column on the Kanboard project board.
 *
 * FR-27: wraps handler.getColumn(column_id) + handler.changeColumnPosition(input).
 * Project_id is derived from getColumn — not required in input.
 * On success, resolver cache is invalidated (NFR-9).
 * Returns { ok: true, column_id, position } on success.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const MoveColumnInput = z
  .object({
    column_id: z.number().int().positive().describe("Column id to move (required)."),
    position: z
      .number()
      .int()
      .min(1)
      .describe("New 1-based position within the project board (required)."),
  })
  .strict();

export type MoveColumnInput = z.infer<typeof MoveColumnInput>;

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

interface MoveColumnResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; column_id: number; position: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const moveColumnTool = {
  name: "move_column",
  description:
    "Reorder a column on the Kanboard project board. " +
    "Provide column_id and the new 1-based position (required — no default). " +
    "Only ordering changes — to rename a column or change its WIP limit use update_column. " +
    "Returns { ok: true, column_id, position } on success.",
  inputSchema: MoveColumnInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<MoveColumnResult> => {
    const parsed = MoveColumnInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "move_column",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    // Resolve project_id via getColumn — needed for changeColumnPosition and invalidation (NFR-9).
    // If column does not exist, NotFoundError propagates as-is.
    const column = await deps.handler.getColumn(input.column_id);

    // Perform the position change — if it throws, do NOT invalidate (mutation didn't happen).
    await deps.handler.changeColumnPosition({
      project_id: column.project_id,
      column_id: input.column_id,
      position: input.position,
    });

    // NFR-9: invalidate resolver cache on success — column order changed.
    deps.resolvers.invalidate(column.project_id);

    return {
      content: [
        {
          type: "text",
          text: `Column ${String(input.column_id)} moved to position ${String(input.position)}.`,
        },
      ],
      structuredContent: { ok: true, column_id: input.column_id, position: input.position },
    };
  },
};
