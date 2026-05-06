/**
 * delete_comment — Permanently delete a Kanboard comment (destructive).
 *
 * Confirm-gated: caller MUST pass `confirm: true`. No resolver invalidation —
 * comments do not affect column/swimlane structure.
 *
 * On success: returns `{ ok: true, comment_id }`.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { assertConfirmed } from "../shared/confirm.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const DeleteCommentInput = z
  .object({
    comment_id: z
      .number()
      .int()
      .positive()
      .describe("Comment id to permanently delete (required)."),
    confirm: z
      .literal(true)
      .describe("Must be exactly `true` to confirm permanent deletion."),
  })
  .strict();

export type DeleteCommentInput = z.infer<typeof DeleteCommentInput>;

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

interface DeleteCommentResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; comment_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const deleteCommentTool = {
  name: "delete_comment",
  description:
    "Permanently delete a Kanboard comment. DESTRUCTIVE — requires explicit `confirm: true`. " +
    "Returns { ok: true, comment_id } on success.",
  inputSchema: DeleteCommentInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<DeleteCommentResult> => {
    const parsed = DeleteCommentInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "delete_comment",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;
    assertConfirmed("delete_comment", input.confirm);

    await deps.handler.removeComment(input.comment_id);

    return {
      content: [
        { type: "text", text: `Comment ${String(input.comment_id)} deleted permanently.` },
      ],
      structuredContent: { ok: true, comment_id: input.comment_id },
    };
  },
};
