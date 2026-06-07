/**
 * create_swimlane — Add a swimlane to a Kanboard project.
 *
 * Wraps handler.addSwimlane(input).
 * Project resolved from explicit project_id/project_identifier or .kanboard.yaml.
 * On success, resolver cache is invalidated (NFR-9) — project structure changed.
 * Returns { swimlane_id } on success.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const CreateSwimlaneInput = z
  .object({
    project_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Kanboard project id (overrides .kanboard.yaml)."),
    project_identifier: z
      .string()
      .optional()
      .describe("Kanboard project identifier string (overrides .kanboard.yaml)."),
    name: z.string().min(1).max(255).describe("Swimlane name (1–255 chars, required)."),
    description: z.string().optional().describe("Optional swimlane description."),
  })
  .strict();

export type CreateSwimlaneInput = z.infer<typeof CreateSwimlaneInput>;

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

interface CreateSwimlaneResult {
  content: { type: "text"; text: string }[];
  structuredContent: { swimlane_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const createSwimlaneTool = {
  name: "create_swimlane",
  description:
    "Add a swimlane to a Kanboard project. " +
    "Project resolved from explicit project_id/project_identifier or .kanboard.yaml. " +
    "To reorder it use move_swimlane, to rename it use update_swimlane, to remove it use delete_swimlane. " +
    "Returns { swimlane_id } on success.",
  inputSchema: CreateSwimlaneInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<CreateSwimlaneResult> => {
    const parsed = CreateSwimlaneInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "create_swimlane",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined
        ? { explicitProjectIdentifier: input.project_identifier }
        : {}),
    });

    const projectId = ctx.projectId;

    const handlerInput: Parameters<KanboardHandler["addSwimlane"]>[0] = {
      project_id: projectId,
      name: input.name,
    };
    if (input.description !== undefined) handlerInput.description = input.description;

    const swimlaneId = await deps.handler.addSwimlane(handlerInput);

    // NFR-9: invalidate resolver cache on success — swimlane structure changed.
    deps.resolvers.invalidate(projectId);

    return {
      content: [{ type: "text", text: JSON.stringify({ swimlane_id: swimlaneId }, null, 2) }],
      structuredContent: { swimlane_id: swimlaneId },
    };
  },
};
