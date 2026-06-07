/**
 * update_comment — Update the body of an existing Kanboard comment.
 *
 * Wraps handler.updateComment(input). The MCP tool input field is `comment_id`;
 * the handler remaps it to wire `id` (Kanboard JSON-RPC contract).
 *
 * Returns { ok: true } on success.
 * Errors propagate unchanged: NotFoundError (missing comment), KanboardApiError
 * (Kanboard JSON-RPC failure), ValidationError (Zod).
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const UpdateCommentInput = z
  .object({
    comment_id: z
      .number()
      .int()
      .positive()
      .describe("Comment id to update (required)."),
    content: z.string().min(1).describe("New comment body text (required, non-empty)."),
  })
  .strict();

export type UpdateCommentInput = z.infer<typeof UpdateCommentInput>;

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

interface UpdateCommentResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; comment_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const updateCommentTool = {
  name: "update_comment",
  description:
    "Update the body of an existing Kanboard comment. " +
    "To remove a comment use delete_comment instead. " +
    "Returns { ok: true, comment_id } on success.",
  inputSchema: UpdateCommentInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<UpdateCommentResult> => {
    const parsed = UpdateCommentInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "update_comment",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    // Handler remaps comment_id → wire `id` internally.
    await deps.handler.updateComment({
      comment_id: input.comment_id,
      content: input.content,
    });

    return {
      content: [
        { type: "text", text: `Comment ${String(input.comment_id)} updated successfully.` },
      ],
      structuredContent: { ok: true, comment_id: input.comment_id },
    };
  },
};
