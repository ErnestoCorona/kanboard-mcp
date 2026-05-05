/**
 * create_column — Add a column to a Kanboard project board.
 *
 * FR-25: wraps handler.addColumn(input).
 * Project resolved from explicit project_id/project_identifier or .kanboard.yaml.
 * On success, resolver cache is invalidated (NFR-9).
 * Returns { column_id } on success.
 */

import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const CreateColumnInput = z
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
    title: z.string().min(1).max(255).describe("Column title (1–255 chars, required)."),
    task_limit: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("WIP limit for the column (0 = unlimited)."),
    description: z.string().optional().describe("Optional column description."),
  })
  .strict();

export type CreateColumnInput = z.infer<typeof CreateColumnInput>;

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

interface CreateColumnResult {
  content: { type: "text"; text: string }[];
  structuredContent: { column_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const createColumnTool = {
  name: "create_column",
  description:
    "Add a column to a Kanboard project board. " +
    "Project resolved from explicit project_id/project_identifier or .kanboard.yaml. " +
    "Returns { column_id } on success.",
  inputSchema: CreateColumnInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<CreateColumnResult> => {
    const parsed = CreateColumnInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "create_column",
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

    const handlerInput: Parameters<KanboardHandler["addColumn"]>[0] = {
      project_id: projectId,
      title: input.title,
    };
    if (input.task_limit !== undefined) handlerInput.task_limit = input.task_limit;
    if (input.description !== undefined) handlerInput.description = input.description;

    const columnId = await deps.handler.addColumn(handlerInput);

    // NFR-9: invalidate resolver cache on success — column structure changed.
    deps.resolvers.invalidate(projectId);

    return {
      content: [{ type: "text", text: JSON.stringify({ column_id: columnId }, null, 2) }],
      structuredContent: { column_id: columnId },
    };
  },
};
