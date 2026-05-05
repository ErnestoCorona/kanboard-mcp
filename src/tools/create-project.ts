/**
 * create_project — Create a new Kanboard project.
 *
 * FR-05: wraps handler.createProject(input).
 * Mutation returning false → API_ERROR (thrown by handler).
 * Returns { project_id: number }.
 */

import { z } from "zod";
import { isoToEpoch } from "../schemas/dates.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const CreateProjectInput = z
  .object({
    name: z.string().min(1).max(255).describe("Project name (1–255 characters, required)."),
    description: z.string().optional().describe("Optional project description."),
    identifier: z
      .string()
      .optional()
      .describe("Optional short identifier (e.g. 'PRJ'). Must be unique across projects."),
    owner_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional numeric user id of the project owner."),
    start_date: z
      .union([z.string(), z.number().int()])
      .optional()
      .describe("Optional start date as ISO 8601 string or Unix epoch seconds (integer)."),
    end_date: z
      .union([z.string(), z.number().int()])
      .optional()
      .describe("Optional end date as ISO 8601 string or Unix epoch seconds (integer)."),
    email: z.string().email().optional().describe("Optional project notification email address."),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

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

interface CreateProjectResult {
  content: { type: "text"; text: string }[];
  structuredContent: { project_id: number };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const createProjectTool = {
  name: "create_project",
  description:
    "Create a new Kanboard project. Requires a name (1–255 chars). " +
    "Optionally provide a description, short identifier, owner user id, " +
    "start_date / end_date (ISO 8601 string or epoch seconds), and email. " +
    "Returns { project_id } on success.",
  inputSchema: CreateProjectInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<CreateProjectResult> => {
    const input = CreateProjectInput.parse(raw);

    const handlerInput: Parameters<KanboardHandler["createProject"]>[0] = { name: input.name };
    if (input.description !== undefined) handlerInput.description = input.description;
    if (input.identifier !== undefined) handlerInput.identifier = input.identifier;
    if (input.owner_id !== undefined) handlerInput.owner_id = input.owner_id;
    if (input.start_date !== undefined) {
      const epoch = isoToEpoch(input.start_date, "start_date");
      if (epoch !== null) handlerInput.start_date = epoch;
    }
    if (input.end_date !== undefined) {
      const epoch = isoToEpoch(input.end_date, "end_date");
      if (epoch !== null) handlerInput.end_date = epoch;
    }
    if (input.email !== undefined) handlerInput.email = input.email;

    const projectId = await deps.handler.createProject(handlerInput);

    return {
      content: [{ type: "text", text: JSON.stringify({ project_id: projectId }, null, 2) }],
      structuredContent: { project_id: projectId },
    };
  },
};
