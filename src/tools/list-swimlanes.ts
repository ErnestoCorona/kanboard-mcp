/**
 * list_swimlanes — List active swimlanes for a Kanboard project.
 *
 * FR-23: wraps handler.getActiveSwimlanes(projectId).
 * Project resolved via resolveProjectContext (explicit > yaml > ConfigError).
 * List returning false → API_ERROR (thrown by handler).
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Swimlane } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListSwimlanesInput = z
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

export type ListSwimlanesInput = z.infer<typeof ListSwimlanesInput>;

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

interface ListSwimlanesResult {
  content: { type: "text"; text: string }[];
  structuredContent: { swimlanes: Swimlane[] };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const listSwimlanesTool = {
  name: "list_swimlanes",
  description:
    "List active swimlanes for a Kanboard project. " +
    "Provide project_id or project_identifier, or configure .kanboard.yaml in your project root. " +
    "Returns an array of swimlane objects with id, name, description, position, and is_active.",
  inputSchema: ListSwimlanesInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListSwimlanesResult> => {
    const input = ListSwimlanesInput.parse(raw);

    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined ? { explicitProjectIdentifier: input.project_identifier } : {}),
    });

    const swimlanes = await deps.handler.getActiveSwimlanes(ctx.projectId);
    return {
      content: [{ type: "text", text: JSON.stringify(swimlanes, null, 2) }],
      structuredContent: { swimlanes },
    };
  },
};
