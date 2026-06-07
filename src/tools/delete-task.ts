/**
 * delete_task — Permanently delete a Kanboard task (destructive).
 *
 * Confirm-gated: caller MUST pass `confirm: true`. Zod's `z.literal(true)`
 * rejects missing/false at parse-time; `assertConfirmed` is a defensive
 * second check inside the handler (defends against direct programmatic
 * consumers that might bypass Zod).
 *
 * On success: returns `{ ok: true, task_id }`.
 * Errors propagate unchanged: NotFoundError (missing task), KanboardApiError
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

export const DeleteTaskInput = z
  .object({
    task_id: z
      .number()
      .int()
      .positive()
      .describe("Task id to permanently delete (required)."),
    confirm: z
      .literal(true)
      .describe("Must be exactly `true` to confirm permanent deletion."),
  })
  .strict();

export type DeleteTaskInput = z.infer<typeof DeleteTaskInput>;

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

interface DeleteTaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; task_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const deleteTaskTool = {
  name: "delete_task",
  description:
    "Permanently delete a Kanboard task. DESTRUCTIVE and irreversible — requires explicit `confirm: true`. " +
    "Returns { ok: true, task_id } on success.",
  inputSchema: DeleteTaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<DeleteTaskResult> => {
    const parsed = DeleteTaskInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "delete_task",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;
    assertConfirmed("delete_task", input.confirm);

    await deps.handler.removeTask(input.task_id);

    return {
      content: [
        { type: "text", text: `Task ${String(input.task_id)} deleted permanently.` },
      ],
      structuredContent: { ok: true, task_id: input.task_id },
    };
  },
};
