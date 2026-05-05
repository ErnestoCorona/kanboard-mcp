/**
 * list_columns — List all columns for a Kanboard project.
 *
 * FR-20: wraps handler.getColumns(projectId).
 * Project resolved via resolveProjectContext (explicit > yaml > ConfigError).
 * List returning false → API_ERROR (thrown by handler).
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Column } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListColumnsInput = z
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

export type ListColumnsInput = z.infer<typeof ListColumnsInput>;

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

interface ListColumnsResult {
  content: { type: "text"; text: string }[];
  structuredContent: { columns: Column[] };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const listColumnsTool = {
  name: "list_columns",
  description:
    "List all columns (board stages) for a Kanboard project. " +
    "Provide project_id or project_identifier, or configure .kanboard.yaml in your project root. " +
    "Returns an array of column objects with id, title, position, and task_limit.",
  inputSchema: ListColumnsInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListColumnsResult> => {
    const input = ListColumnsInput.parse(raw);

    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined ? { explicitProjectIdentifier: input.project_identifier } : {}),
    });

    const columns = await deps.handler.getColumns(ctx.projectId);
    return {
      content: [{ type: "text", text: JSON.stringify(columns, null, 2) }],
      structuredContent: { columns },
    };
  },
};
