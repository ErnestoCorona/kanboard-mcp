/**
 * delete_swimlane — Permanently delete a Kanboard swimlane (destructive).
 *
 * Confirm-gated: caller MUST pass `confirm: true`. Zod's `z.literal(true)`
 * rejects missing/false at parse-time; `assertConfirmed` is a defensive
 * second check inside the handler.
 *
 * Project_id is derived from getSwimlane — needed by removeSwimlane and for
 * resolver invalidation (NFR-9).
 *
 * On success: returns `{ ok: true, swimlane_id }`.
 * Errors propagate unchanged: NotFoundError (missing swimlane), KanboardApiError
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

export const DeleteSwimlaneInput = z
  .object({
    swimlane_id: z
      .number()
      .int()
      .positive()
      .describe("Swimlane id to permanently delete (required)."),
    confirm: z
      .literal(true)
      .describe("Must be exactly `true` to confirm permanent deletion."),
  })
  .strict();

export type DeleteSwimlaneInput = z.infer<typeof DeleteSwimlaneInput>;

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

interface DeleteSwimlaneResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; swimlane_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const deleteSwimlaneTool = {
  name: "delete_swimlane",
  description:
    "Permanently delete a Kanboard swimlane. DESTRUCTIVE — requires explicit `confirm: true`. " +
    "Returns { ok: true, swimlane_id } on success.",
  inputSchema: DeleteSwimlaneInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<DeleteSwimlaneResult> => {
    const parsed = DeleteSwimlaneInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "delete_swimlane",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;
    assertConfirmed("delete_swimlane", input.confirm);

    // Resolve project_id via getSwimlane — needed by removeSwimlane and for invalidation (NFR-9).
    // If swimlane does not exist, NotFoundError propagates as-is.
    const swimlane = await deps.handler.getSwimlane(input.swimlane_id);

    await deps.handler.removeSwimlane({
      project_id: swimlane.project_id,
      swimlane_id: input.swimlane_id,
    });

    // NFR-9: invalidate resolver cache on success — swimlane removed.
    deps.resolvers.invalidate(swimlane.project_id);

    return {
      content: [
        { type: "text", text: `Swimlane ${String(input.swimlane_id)} deleted permanently.` },
      ],
      structuredContent: { ok: true, swimlane_id: input.swimlane_id },
    };
  },
};
