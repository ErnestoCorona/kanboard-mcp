/**
 * update_swimlane — Update an existing Kanboard swimlane (partial update).
 *
 * Wraps handler.getSwimlane(swimlane_id) + handler.updateSwimlane(input).
 * At least one updatable field besides swimlane_id must be provided.
 * Cross-field validation runs in the handler (NOT in the schema) so that
 * inputSchema remains a plain ZodObject — the MCP SDK only reads ZodObject.shape.
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

// NOTE: Do NOT add top-level .refine() to this schema. The MCP SDK
// normalizeObjectSchema() only reads ZodObject.shape; a top-level .refine()
// produces ZodEffects which has no .shape and collapses tools/list to {}.
// Cross-field validation belongs in the handler body instead.
export const UpdateSwimlaneInput = z
  .object({
    swimlane_id: z.number().int().positive().describe("Swimlane id to update (required)."),
    name: z.string().min(1).max(255).optional().describe("New swimlane name (1–255 chars)."),
    description: z.string().optional().describe("New swimlane description."),
  })
  .strict();

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

    if (!UPDATABLE_FIELDS.some((field) => input[field] !== undefined)) {
      throw new ValidationError(
        "update_swimlane",
        "At least one updatable field is required (name or description).",
        { provided_fields: Object.keys(input) },
      );
    }

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
