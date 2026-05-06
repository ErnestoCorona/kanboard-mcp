/**
 * remove_project_user — Unlink a user from a Kanboard project (destructive on the relationship).
 *
 * Verb is `remove_*` (not `delete_*`) per ADR/orchestrator-correction:
 * relationship-management semantics (vincular/desvincular), not entity
 * lifecycle. Mirrors GitHub `removeCollaborator`, AWS IAM detach-user verbs.
 *
 * Confirm-gated: caller MUST pass `confirm: true`.
 * NFR-9: on success the resolver cache for the project is invalidated
 * (membership change can affect downstream resolver decisions).
 *
 * On success: returns `{ ok: true, project_id, user_id }`.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { assertConfirmed } from "../shared/confirm.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const RemoveProjectUserInput = z
  .object({
    project_id: z
      .number()
      .int()
      .positive()
      .describe("Numeric project id."),
    user_id: z
      .number()
      .int()
      .positive()
      .describe("Numeric user id to unlink from the project."),
    confirm: z
      .literal(true)
      .describe("Must be exactly `true` to confirm unlinking the user."),
  })
  .strict();

export type RemoveProjectUserInput = z.infer<typeof RemoveProjectUserInput>;

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

interface RemoveProjectUserResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; project_id: number; user_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const removeProjectUserTool = {
  name: "remove_project_user",
  description:
    "Unlink a user from a Kanboard project (does not delete the user). " +
    "DESTRUCTIVE on the project-user relationship — requires explicit `confirm: true`. " +
    "Returns { ok: true, project_id, user_id } on success.",
  inputSchema: RemoveProjectUserInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<RemoveProjectUserResult> => {
    const parsed = RemoveProjectUserInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "remove_project_user",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;
    assertConfirmed("remove_project_user", input.confirm);

    await deps.handler.removeProjectUser({
      project_id: input.project_id,
      user_id: input.user_id,
    });

    // NFR-9: invalidate resolver cache on success — project membership changed.
    deps.resolvers.invalidate(input.project_id);

    return {
      content: [
        {
          type: "text",
          text: `User ${String(input.user_id)} removed from project ${String(input.project_id)}.`,
        },
      ],
      structuredContent: {
        ok: true,
        project_id: input.project_id,
        user_id: input.user_id,
      },
    };
  },
};
