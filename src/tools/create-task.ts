/**
 * create_task — Create a new task in a Kanboard project.
 *
 * Project is resolved from explicit project_id / project_identifier or from .kanboard.yaml.
 * Optional fields default to .kanboard.yaml values when present.
 * Returns { task_id } on success.
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import { isoToEpoch } from "../schemas/dates.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const CreateTaskInput = z
  .object({
    project_id: z.number().int().positive().optional().describe("Kanboard project id (overrides .kanboard.yaml)."),
    project_identifier: z.string().optional().describe("Kanboard project identifier string (overrides .kanboard.yaml)."),
    title: z.string().min(1).max(255).describe("Task title (1–255 characters, required)."),
    description: z.string().optional().describe("Task description (optional)."),
    column_id: z.number().int().positive().optional().describe("Column id. Falls back to .kanboard.yaml default_column_id."),
    owner_id: z.number().int().positive().optional().describe("Owner user id. Falls back to .kanboard.yaml default_owner_id."),
    color_id: z.string().optional().describe("Color identifier (e.g. 'blue', 'red')."),
    date_due: z.union([z.string(), z.number().int(), z.null()]).optional().describe("Due date as ISO 8601 string, Unix epoch seconds (integer), or null to clear."),
    category_id: z.number().int().positive().optional().describe("Category id. Falls back to .kanboard.yaml default_category_id."),
    swimlane_id: z.number().int().positive().optional().describe("Swimlane id. Falls back to .kanboard.yaml default_swimlane_id."),
    score: z.number().int().optional().describe("Task complexity score."),
    priority: z.number().int().optional().describe("Task priority."),
    reference: z.string().optional().describe("External reference (e.g. issue URL)."),
    tags: z.array(z.string()).optional().describe("Array of tag strings."),
    date_started: z.union([z.string(), z.number().int(), z.null()]).optional().describe("Start date as ISO 8601 string, Unix epoch seconds (integer), or null to clear."),
    creator_id: z.number().int().positive().optional().describe("Creator user id."),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

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

interface CreateTaskResult {
  content: { type: "text"; text: string }[];
  structuredContent: { task_id: number; project_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const createTaskTool = {
  name: "create_task",
  description:
    "Create a new task in a Kanboard project. " +
    "Project is resolved from explicit project_id or project_identifier, or from .kanboard.yaml. " +
    "Optional fields (column_id, owner_id, category_id, swimlane_id) fall back to .kanboard.yaml defaults when not provided. " +
    "To create many tasks at once use create_tasks_batch; to move the task afterward use move_task_position. " +
    "Returns { task_id, project_id } on success.",
  inputSchema: CreateTaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<CreateTaskResult> => {
    const input = CreateTaskInput.parse(raw);

    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined ? { explicitProjectIdentifier: input.project_identifier } : {}),
    });

    const task_id = await deps.handler.createTask({
      project_id: ctx.projectId,
      title: input.title,
      description: input.description,
      column_id: input.column_id ?? ctx.defaults.columnId,
      owner_id: input.owner_id ?? ctx.defaults.ownerId,
      category_id: input.category_id ?? ctx.defaults.categoryId,
      swimlane_id: input.swimlane_id ?? ctx.defaults.swimlaneId,
      color_id: input.color_id,
      date_due: isoToEpoch(input.date_due, "date_due") ?? undefined,
      score: input.score,
      priority: input.priority,
      reference: input.reference,
      tags: input.tags,
      date_started: isoToEpoch(input.date_started, "date_started") ?? undefined,
      creator_id: input.creator_id,
    });

    return {
      content: [
        {
          type: "text",
          text: `Task ${String(task_id)} created in project ${String(ctx.projectId)}.`,
        },
      ],
      structuredContent: { task_id, project_id: ctx.projectId },
    };
  },
};
