/**
 * update_swimlane — Update an existing Kanboard swimlane (partial update).
 *
 * Wraps handler.getSwimlane(swimlane_id) + handler.updateSwimlane(input).
 * At least one updatable field besides swimlane_id must be provided (Zod refine).
 * On success, resolver cache is invalidated (NFR-9) using project_id from getSwimlane.
 * Returns { ok: true, swimlane_id } on success.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Updatable fields (excludes swimlane_id)
// ---------------------------------------------------------------------------

const UPDATABLE_FIELDS = ["name", "description"] as const;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const UpdateSwimlaneInput = z
  .object({
    swimlane_id: z.number().int().positive().describe("Swimlane id to update (required)."),
    name: z.string().min(1).max(255).optional().describe("New swimlane name (1–255 chars)."),
    description: z.string().optional().describe("New swimlane description."),
  })
  .strict()
  .refine(
    (data) => UPDATABLE_FIELDS.some((field) => data[field] !== undefined),
    {
      message: "At least one updatable field is required (name or description).",
    },
  );

export type UpdateSwimlaneInput = z.infer<typeof UpdateSwimlaneInput>;

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

interface UpdateSwimlaneResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; swimlane_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const updateSwimlaneTool = {
  name: "update_swimlane",
  description:
    "Update an existing Kanboard swimlane (partial update). " +
    "At least one field besides 'swimlane_id' must be provided — otherwise VALIDATION_ERROR. " +
    "NOT for reordering — use move_swimlane instead. " +
    "Returns { ok: true, swimlane_id } on success.",
  inputSchema: UpdateSwimlaneInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<UpdateSwimlaneResult> => {
    const parsed = UpdateSwimlaneInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "update_swimlane",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    // Resolve project_id via getSwimlane — needed for resolver invalidation (NFR-9).
    // If swimlane does not exist, NotFoundError propagates as-is.
    const swimlane = await deps.handler.getSwimlane(input.swimlane_id);

    // Perform the update — if it throws, do NOT invalidate (mutation didn't happen).
    await deps.handler.updateSwimlane({
      swimlane_id: input.swimlane_id,
      name: input.name,
      description: input.description,
    });

    // NFR-9: invalidate resolver cache on success — swimlane structure changed.
    deps.resolvers.invalidate(swimlane.project_id);

    return {
      content: [
        { type: "text", text: `Swimlane ${String(input.swimlane_id)} updated successfully.` },
      ],
      structuredContent: { ok: true, swimlane_id: input.swimlane_id },
    };
  },
};
