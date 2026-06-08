/**
 * close_task — Close (archive) an active Kanboard task (reversible).
 *
 * Sets the task's `is_active` flag to 0: it leaves the active board but is
 * preserved (NOT deleted). The inverse is `reopen_task`. Because the operation
 * is reversible, there is NO `confirm: true` gate (unlike `delete_task`).
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

export const CloseTaskInput = z
  .object({
    task_id: z
      .number()
      .int()
      .positive()
      .describe("Id of the task to close (required)."),
  })
  .strict();

export type CloseTaskInput = z.infer<typeof CloseTaskInput>;

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

interface CloseTaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; task_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const closeTaskTool = {
  name: "close_task",
  description:
    "Close (archive) an active Kanboard task. The task is set inactive and leaves the active board " +
    "but is preserved — this is NOT a delete. Reversible: restore it with reopen_task. " +
    "To permanently remove a task instead, use delete_task. Returns { ok: true, task_id } on success.",
  inputSchema: CloseTaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<CloseTaskResult> => {
    const parsed = CloseTaskInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "close_task",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    await deps.handler.closeTask(input.task_id);

    return {
      content: [
        { type: "text", text: `Task ${String(input.task_id)} closed.` },
      ],
      structuredContent: { ok: true, task_id: input.task_id },
    };
  },
};
