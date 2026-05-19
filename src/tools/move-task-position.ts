/**
 * move_task_position — Move a task to a different column/position/swimlane.
 *
 * Accepts column_id XOR column_name (exactly one required; checked in handler body).
 * Cross-field XOR validation runs in the handler (NOT in the schema) so that
 * inputSchema remains a plain ZodObject — the MCP SDK only reads ZodObject.shape.
 * If column_name is provided, it is resolved to column_id via Resolvers.resolveColumnIdByName().
 * If swimlane_id is absent, it is resolved via Resolvers.resolveDefaultSwimlaneId()
 * using ctx.defaults.swimlaneId (undefined when not in .kanboard.yaml — NOT 0).
 *
 * On handler error, invalidates project cache via resolvers.invalidate(projectId).
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

// NOTE: Do NOT add top-level .refine() to this schema. The MCP SDK
// normalizeObjectSchema() only reads ZodObject.shape; a top-level .refine()
// produces ZodEffects which has no .shape and collapses tools/list to {}.
// Cross-field XOR validation belongs in the handler body instead.
export const MoveTaskPositionInput = z
  .object({
    project_id: z.number().int().positive().optional().describe("Kanboard project id (overrides .kanboard.yaml)."),
    project_identifier: z.string().optional().describe("Kanboard project identifier string (overrides .kanboard.yaml)."),
    task_id: z.number().int().positive().describe("The task id to move."),
    column_id: z.number().int().positive().optional().describe("Target column id. Mutually exclusive with column_name."),
    column_name: z.string().min(1).optional().describe("Target column name (case-insensitive). Mutually exclusive with column_id."),
    swimlane_id: z.number().int().positive().optional().describe("Target swimlane id. Falls back to .kanboard.yaml default or first active swimlane."),
    position: z.number().int().min(1).optional().default(1).describe("Position within the column (1-based, defaults to 1 = top)."),
  })
  .strict();

export type MoveTaskPositionInput = z.infer<typeof MoveTaskPositionInput>;

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

interface MoveTaskPositionResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; task_id: number; column_id: number; swimlane_id: number; position: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const moveTaskPositionTool = {
  name: "move_task_position",
  description:
    "Move a Kanboard task to a different column, position, or swimlane. " +
    "Provide exactly one of column_id or column_name (column_name is resolved case-insensitively). " +
    "If swimlane_id is omitted, it is resolved from .kanboard.yaml or the first active swimlane. " +
    "Project is resolved from explicit project_id or project_identifier, or from .kanboard.yaml. " +
    "Returns { ok: true } on success.",
  inputSchema: MoveTaskPositionInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<MoveTaskPositionResult> => {
    const parsed = MoveTaskPositionInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "move_task_position",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    if ((input.column_id !== undefined) === (input.column_name !== undefined)) {
      throw new ValidationError(
        "move_task_position",
        "Exactly one of column_id or column_name must be provided (not both, not neither).",
        { column_id: input.column_id, column_name: input.column_name },
      );
    }

    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined ? { explicitProjectIdentifier: input.project_identifier } : {}),
    });

    const projectId = ctx.projectId;

    // ── Resolve column_id ────────────────────────────────────────────────────

    let resolvedColumnId: number;

    if (input.column_id !== undefined) {
      resolvedColumnId = input.column_id;
    } else {
      // column_name is guaranteed defined by the handler-side XOR check above.
      resolvedColumnId = await deps.resolvers.resolveColumnIdByName(projectId, input.column_name!);
    }

    // ── Resolve swimlane_id ──────────────────────────────────────────────────

    let resolvedSwimlaneId: number;

    if (input.swimlane_id !== undefined) {
      resolvedSwimlaneId = input.swimlane_id;
    } else {
      // Pass ctx.defaults.swimlaneId (may be undefined — NOT 0).
      // Resolvers treats 0 as "explicitly provided"; undefined triggers fetch.
      resolvedSwimlaneId = await deps.resolvers.resolveDefaultSwimlaneId(
        projectId,
        ctx.defaults.swimlaneId,
      );
    }

    // ── Call handler ─────────────────────────────────────────────────────────

    try {
      await deps.handler.moveTaskPosition({
        project_id: projectId,
        task_id: input.task_id,
        column_id: resolvedColumnId,
        position: input.position,
        swimlane_id: resolvedSwimlaneId,
      });
    } catch (err) {
      // Invalidate stale caches on any move failure (column may have been renamed).
      deps.resolvers.invalidate(projectId);
      throw err;
    }

    return {
      content: [
        {
          type: "text",
          text: `Task ${String(input.task_id)} moved to column ${String(resolvedColumnId)}, position ${String(input.position)}, swimlane ${String(resolvedSwimlaneId)}.`,
        },
      ],
      structuredContent: {
        ok: true,
        task_id: input.task_id,
        column_id: resolvedColumnId,
        swimlane_id: resolvedSwimlaneId,
        position: input.position,
      },
    };
  },
};
