/**
 * update_project — Update an existing Kanboard project (partial update).
 *
 * FR-24: wraps handler.updateProject(input).
 * At least one updatable field besides `project_id` must be provided (Zod refine).
 * Returns { ok: true, project_id } on success.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { isoToEpoch } from "../schemas/dates.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Updatable fields (excludes project_id per spec FR-24)
// ---------------------------------------------------------------------------

const UPDATABLE_FIELDS = [
  "name",
  "description",
  "identifier",
  "owner_id",
  "start_date",
  "end_date",
  "email",
] as const;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const UpdateProjectInput = z
  .object({
    project_id: z.number().int().positive().describe("Project id to update (required)."),
    name: z.string().min(1).max(255).optional().describe("New project name (1–255 chars)."),
    description: z.string().optional().describe("New project description."),
    identifier: z.string().optional().describe("New short identifier (e.g. 'PRJ'). Must be unique."),
    owner_id: z.number().int().positive().optional().describe("New owner user id."),
    start_date: z
      .union([z.string(), z.number().int(), z.null()])
      .optional()
      .describe("New start date as ISO 8601 string, Unix epoch seconds (integer), or null to clear."),
    end_date: z
      .union([z.string(), z.number().int(), z.null()])
      .optional()
      .describe("New end date as ISO 8601 string, Unix epoch seconds (integer), or null to clear."),
    email: z.string().email().optional().describe("New project notification email address."),
  })
  .strict()
  .refine(
    (data) => UPDATABLE_FIELDS.some((field) => data[field] !== undefined),
    {
      message:
        "At least one updatable field is required (name, description, identifier, owner_id, start_date, end_date, or email).",
    },
  );

export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

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

interface UpdateProjectResult {
  content: { type: "text"; text: string }[];
  structuredContent: { ok: true; project_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const updateProjectTool = {
  name: "update_project",
  description:
    "Update an existing Kanboard project (partial update). " +
    "At least one field besides 'project_id' must be provided — otherwise VALIDATION_ERROR. " +
    "Returns { ok: true } on success.",
  inputSchema: UpdateProjectInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<UpdateProjectResult> => {
    const parsed = UpdateProjectInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "update_project",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    await deps.handler.updateProject({
      project_id: input.project_id,
      name: input.name,
      description: input.description,
      identifier: input.identifier,
      owner_id: input.owner_id,
      start_date: isoToEpoch(input.start_date, "start_date") ?? undefined,
      end_date: isoToEpoch(input.end_date, "end_date") ?? undefined,
      email: input.email,
    });

    return {
      content: [{ type: "text", text: `Project ${String(input.project_id)} updated successfully.` }],
      structuredContent: { ok: true, project_id: input.project_id },
    };
  },
};
