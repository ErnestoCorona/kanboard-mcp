/**
 * get_project — Retrieve a single Kanboard project by id, identifier, or name.
 *
 * Exactly one of project_id, project_identifier, or project_name must be provided.
 * FR-04: wraps getProjectById | getProjectByName | getProjectByIdentifier.
 * Getter returning null → NOT_FOUND (thrown by handler).
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Project } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema — discriminated union enforced by Zod refine
// ---------------------------------------------------------------------------

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
  .strict()
  .refine(
    (d) => {
      const count = [d.project_id, d.project_identifier, d.project_name].filter(
        (v) => v !== undefined,
      ).length;
      return count === 1;
    },
    {
      message:
        "Exactly one of project_id, project_identifier, or project_name must be provided.",
    },
  );

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
    const input = GetProjectInput.parse(raw);

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

    // Zod refine guarantees exactly one field — this path is unreachable at runtime.
    throw new ValidationError(
      "get_project",
      "No project lookup field was provided (Zod refine should have caught this).",
    );
  },
};
