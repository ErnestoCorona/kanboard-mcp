/**
 * move_swimlane — Reorder a swimlane within a Kanboard project.
 *
 * Wraps handler.getSwimlane(swimlane_id) + handler.changeSwimlanePosition(input).
 * Project_id is derived from getSwimlane — not required in input.
 * On success, resolver cache is invalidated (NFR-9).
 * Returns { ok: true, swimlane_id, position } on success.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const MoveSwimlaneInput = z
  .object({
    swimlane_id: z.number().int().positive().describe("Swimlane id to move (required)."),
    position: z
      .number()
      .int()
      .min(1)
      .describe("New 1-based position within the project (required)."),
  })
  .strict();

export type MoveSwimlaneInput = z.infer<typeof MoveSwimlaneInput>;

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

interface MoveSwimlaneResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; swimlane_id: number; position: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const moveSwimlaneTool = {
  name: "move_swimlane",
  description:
    "Reorder a swimlane within a Kanboard project. " +
    "Provide swimlane_id and the new 1-based position (required — no default). " +
    "Returns { ok: true, swimlane_id, position } on success.",
  inputSchema: MoveSwimlaneInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<MoveSwimlaneResult> => {
    const parsed = MoveSwimlaneInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "move_swimlane",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    // Resolve project_id via getSwimlane — needed for changeSwimlanePosition and invalidation (NFR-9).
    // If swimlane does not exist, NotFoundError propagates as-is.
    const swimlane = await deps.handler.getSwimlane(input.swimlane_id);

    // Perform the position change — if it throws, do NOT invalidate (mutation didn't happen).
    await deps.handler.changeSwimlanePosition({
      project_id: swimlane.project_id,
      swimlane_id: input.swimlane_id,
      position: input.position,
    });

    // NFR-9: invalidate resolver cache on success — swimlane order changed.
    deps.resolvers.invalidate(swimlane.project_id);

    return {
      content: [
        {
          type: "text",
          text: `Swimlane ${String(input.swimlane_id)} moved to position ${String(input.position)}.`,
        },
      ],
      structuredContent: { ok: true, swimlane_id: input.swimlane_id, position: input.position },
    };
  },
};
