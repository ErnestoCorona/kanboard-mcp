/**
 * delete_project — Permanently delete a Kanboard project (destructive).
 *
 * Confirm-gated: caller MUST pass `confirm: true`. NFR-9: on success the
 * resolver cache for the affected project is invalidated (project columns
 * and swimlanes vanish with the project).
 *
 * On success: returns `{ ok: true, project_id }`.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { assertConfirmed } from "../shared/confirm.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const DeleteProjectInput = z
  .object({
    project_id: z
      .number()
      .int()
      .positive()
      .describe("Project id to permanently delete (required)."),
    confirm: z
      .literal(true)
      .describe("Must be exactly `true` to confirm permanent deletion."),
  })
  .strict();

export type DeleteProjectInput = z.infer<typeof DeleteProjectInput>;

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

interface DeleteProjectResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; project_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const deleteProjectTool = {
  name: "delete_project",
  description:
    "Permanently delete a Kanboard project (and all its tasks, columns, swimlanes). " +
    "DESTRUCTIVE — requires explicit `confirm: true`. " +
    "Returns { ok: true, project_id } on success.",
  inputSchema: DeleteProjectInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<DeleteProjectResult> => {
    const parsed = DeleteProjectInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "delete_project",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;
    assertConfirmed("delete_project", input.confirm);

    await deps.handler.removeProject(input.project_id);

    // NFR-9: invalidate resolver cache on success — project no longer exists.
    deps.resolvers.invalidate(input.project_id);

    return {
      content: [
        {
          type: "text",
          text: `Project ${String(input.project_id)} deleted permanently.`,
        },
      ],
      structuredContent: { ok: true, project_id: input.project_id },
    };
  },
};
