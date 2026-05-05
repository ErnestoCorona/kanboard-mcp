/**
 * list_categories — List all categories for a Kanboard project.
 *
 * FR-21: wraps handler.getAllCategories(projectId).
 * Project resolved via resolveProjectContext (explicit > yaml > ConfigError).
 * List returning false → API_ERROR (thrown by handler).
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Category } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListCategoriesInput = z
  .object({
    project_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Numeric project id. Falls back to .kanboard.yaml when omitted."),
    project_identifier: z
      .string()
      .min(1)
      .optional()
      .describe("Short project identifier. Falls back to .kanboard.yaml when omitted."),
  })
  .strict();

export type ListCategoriesInput = z.infer<typeof ListCategoriesInput>;

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

interface ListCategoriesResult {
  content: { type: "text"; text: string }[];
  structuredContent: { categories: Category[] };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const listCategoriesTool = {
  name: "list_categories",
  description:
    "List all categories for a Kanboard project. " +
    "Provide project_id or project_identifier, or configure .kanboard.yaml in your project root. " +
    "Returns an array of category objects with id, name, and color_id.",
  inputSchema: ListCategoriesInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListCategoriesResult> => {
    const input = ListCategoriesInput.parse(raw);

    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined ? { explicitProjectIdentifier: input.project_identifier } : {}),
    });

    const categories = await deps.handler.getAllCategories(ctx.projectId);
    return {
      content: [{ type: "text", text: JSON.stringify(categories, null, 2) }],
      structuredContent: { categories },
    };
  },
};
