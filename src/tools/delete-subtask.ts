/**
 * delete_subtask — Permanently delete a Kanboard subtask (destructive).
 *
 * Confirm-gated: caller MUST pass `confirm: true`. No resolver invalidation —
 * subtasks do not affect column/swimlane structure.
 *
 * On success: returns `{ ok: true, subtask_id }`.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { assertConfirmed } from "../shared/confirm.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const DeleteSubtaskInput = z
  .object({
    subtask_id: z
      .number()
      .int()
      .positive()
      .describe("Subtask id to permanently delete (required)."),
    confirm: z
      .literal(true)
      .describe("Must be exactly `true` to confirm permanent deletion."),
  })
  .strict();

export type DeleteSubtaskInput = z.infer<typeof DeleteSubtaskInput>;

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

interface DeleteSubtaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; subtask_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const deleteSubtaskTool = {
  name: "delete_subtask",
  description:
    "Permanently delete a Kanboard subtask. DESTRUCTIVE — requires explicit `confirm: true`. " +
    "Returns { ok: true, subtask_id } on success.",
  inputSchema: DeleteSubtaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<DeleteSubtaskResult> => {
    const parsed = DeleteSubtaskInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "delete_subtask",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;
    assertConfirmed("delete_subtask", input.confirm);

    await deps.handler.removeSubtask(input.subtask_id);

    return {
      content: [
        { type: "text", text: `Subtask ${String(input.subtask_id)} deleted permanently.` },
      ],
      structuredContent: { ok: true, subtask_id: input.subtask_id },
    };
  },
};
