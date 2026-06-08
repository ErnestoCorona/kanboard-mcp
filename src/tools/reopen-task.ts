/**
 * reopen_task — Reopen a closed (inactive) Kanboard task (reversible).
 *
 * Sets the task's `is_active` flag back to 1: it returns to the active board.
 * The inverse of `close_task`. Because the operation is reversible, there is
 * NO `confirm: true` gate (unlike `delete_task`).
 *
 * On success: returns `{ ok: true, task_id }`.
 * Errors propagate unchanged: NotFoundError (missing task), KanboardApiError
 * (Kanboard JSON-RPC failure), ValidationError (Zod).
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ReopenTaskInput = z
  .object({
    task_id: z
      .number()
      .int()
      .positive()
      .describe("Id of the task to reopen (required)."),
  })
  .strict();

export type ReopenTaskInput = z.infer<typeof ReopenTaskInput>;

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

interface ReopenTaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; task_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const reopenTaskTool = {
  name: "reopen_task",
  description:
    "Reopen a closed (inactive) Kanboard task, restoring it to the active board. " +
    "The inverse of close_task. Returns { ok: true, task_id } on success.",
  inputSchema: ReopenTaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ReopenTaskResult> => {
    const parsed = ReopenTaskInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "reopen_task",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    await deps.handler.openTask(input.task_id);

    return {
      content: [
        { type: "text", text: `Task ${String(input.task_id)} reopened.` },
      ],
      structuredContent: { ok: true, task_id: input.task_id },
    };
  },
};
