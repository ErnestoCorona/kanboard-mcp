/**
 * get_project — Retrieve a single Kanboard project by id, identifier, or name.
 *
 * Exactly one of project_id, project_identifier, or project_name must be provided.
 * Cross-field validation runs in the handler (NOT in the schema) so that
 * inputSchema remains a plain ZodObject — the MCP SDK only reads ZodObject.shape.
 * FR-04: wraps getProjectById | getProjectByName | getProjectByIdentifier.
 * Getter returning null → NOT_FOUND (thrown by handler).
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Project } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema — cross-field "exactly one" check enforced in handler body
// ---------------------------------------------------------------------------

// NOTE: Do NOT add top-level .refine() to this schema. The MCP SDK
// normalizeObjectSchema() only reads ZodObject.shape; a top-level .refine()
// produces ZodEffects which has no .shape and collapses tools/list to {}.
// Cross-field validation belongs in the handler body instead.
export const GetProjectInput = z
  .object({
    project_id: z.number().int().positive().optional().describe("Numeric project id."),
    project_identifier: z
      .string()
      .min(1)
      .optional()
      .describe("Short project identifier string (e.g. 'PRJ')."),
    project_name: z.string().min(1).optional().describe("Exact project name."),
  })
  .strict();

export type GetProjectInput = z.infer<typeof GetProjectInput>;

// ---------------------------------------------------------------------------
// Tool deps
// ---------------------------------------------------------------------------

export interface ToolDeps {
  handler: KanboardHandler;
  resolvers: Resolvers;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface GetProjectResult {
  content: { type: "text"; text: string }[];
  structuredContent: { project: Project };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const getProjectTool = {
  name: "get_project",
  description:
    "Retrieve a single Kanboard project. Provide exactly one of: project_id (number), " +
    "project_identifier (short string like 'PRJ'), or project_name (full name). " +
    "Returns the full project object. Returns NOT_FOUND when no match exists.",
  inputSchema: GetProjectInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<GetProjectResult> => {
    const parsed = GetProjectInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "get_project",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    const count = [input.project_id, input.project_identifier, input.project_name].filter(
      (v) => v !== undefined,
    ).length;
    if (count !== 1) {
      throw new ValidationError(
        "get_project",
        "Exactly one of project_id, project_identifier, or project_name must be provided.",
        { provided_fields: Object.keys(input) },
      );
    }

    if (input.project_id !== undefined) {
      const project = await deps.handler.getProjectById(input.project_id);
      return {
        content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
        structuredContent: { project },
      };
    }

    if (input.project_identifier !== undefined) {
      const project = await deps.handler.getProjectByIdentifier(input.project_identifier);
      return {
        content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
        structuredContent: { project },
      };
    }

    if (input.project_name !== undefined) {
      const project = await deps.handler.getProjectByName(input.project_name);
      return {
        content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
        structuredContent: { project },
      };
    }

    // Handler-side check above guarantees exactly one field — this path is unreachable at runtime.
    throw new ValidationError(
      "get_project",
      "No project lookup field was provided (handler check should have caught this).",
    );
  },
};
