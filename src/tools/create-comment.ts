/**
 * create_comment — Add a comment to a Kanboard task.
 *
 * Renamed from `add_comment` in v0.3.0 for verb uniformity with the rest of
 * the create_* family. The Kanboard JSON-RPC method underneath is still
 * `createComment`.
 *
 * FR-16: user_id is injected automatically from the cached getMe() result.
 * The tool input MUST NOT accept user_id — the handler auto-injects it.
 * If the getMe() cache failed (invalid token), AuthError is propagated.
 *
 * Returns { comment_id } on success.
 */

import { z } from "zod";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const CreateCommentInput = z
  .object({
    task_id: z.number().int().positive().describe("ID of the task to comment on."),
    content: z.string().min(1).describe("Comment body text (required, non-empty)."),
    reference: z.string().optional().describe("Optional external reference (e.g. issue URL)."),
    visibility: z
      .enum(["app-user", "app-manager", "app-admin"])
      .default("app-user")
      .describe("Comment visibility level. Default: 'app-user'."),
  })
  .strict();

export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

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

interface CreateCommentResult {
  content: { type: "text"; text: string }[];
  structuredContent: { comment_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const createCommentTool = {
  name: "create_comment",
  description:
    "Create a comment on a Kanboard task. " +
    "The comment author is automatically set to the authenticated user (via getMe() cache); do NOT pass user_id — it is injected server-side. " +
    "To edit a comment's body use update_comment; to remove one use delete_comment. " +
    "Returns { comment_id } on success.",
  inputSchema: CreateCommentInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<CreateCommentResult> => {
    const input = CreateCommentInput.parse(raw);

    // handler.createComment auto-injects user_id from getMe() cache.
    // If getMe failed (invalid token), AuthError propagates here.
    const comment_id = await deps.handler.createComment({
      task_id: input.task_id,
      content: input.content,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      visibility: input.visibility,
    });

    return {
      content: [
        {
          type: "text",
          text: `Comment ${String(comment_id)} created on task ${String(input.task_id)}.`,
        },
      ],
      structuredContent: { comment_id },
    };
  },
};
