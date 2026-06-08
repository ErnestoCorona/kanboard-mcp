/**
 * delete_task_file — Permanently delete a file attached to a Kanboard task (destructive).
 *
 * Confirm-gated: caller MUST pass `confirm: true`. No resolver invalidation —
 * file deletes do not affect column/swimlane structure.
 *
 * On success: returns `{ ok: true, file_id }`.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { assertConfirmed } from "../shared/confirm.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const DeleteTaskFileInput = z
  .object({
    file_id: z
      .number()
      .int()
      .positive()
      .describe("File id to permanently delete (required)."),
    confirm: z
      .literal(true)
      .describe("Must be exactly `true` to confirm permanent deletion."),
  })
  .strict();

export type DeleteTaskFileInput = z.infer<typeof DeleteTaskFileInput>;

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

interface DeleteTaskFileResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; file_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const deleteTaskFileTool = {
  name: "delete_task_file",
  description:
    "Permanently delete a file attachment from a Kanboard task. " +
    "DESTRUCTIVE and irreversible — requires explicit `confirm: true`. " +
    "To add an attachment use attach_file_to_task. " +
    "Returns { ok: true, file_id } on success.",
  inputSchema: DeleteTaskFileInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<DeleteTaskFileResult> => {
    const parsed = DeleteTaskFileInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "delete_task_file",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;
    assertConfirmed("delete_task_file", input.confirm);

    await deps.handler.removeTaskFile(input.file_id);

    return {
      content: [
        { type: "text", text: `Task file ${String(input.file_id)} deleted permanently.` },
      ],
      structuredContent: { ok: true, file_id: input.file_id },
    };
  },
};
