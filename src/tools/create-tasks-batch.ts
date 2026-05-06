/**
 * create_tasks_batch — Bulk-create tasks in a single JSON-RPC batch POST.
 *
 * THE killer feature of v1. FR-14, S2, S8, R4.
 *
 * Design:
 * - Non-atomic: partial failure is expected and reported in failed[].
 * - NEVER throws on partial failure — always returns the {created, failed} envelope.
 * - Single HTTP POST with a JSON-RPC batch body (array of createTask envelopes).
 * - yaml defaults are merged into each item where the item's field is undefined.
 * - project_id is injected into every item from resolved context.
 * - Cap: 1..BATCH_TASK_CAP items (Zod min/max enforced).
 *
 * Returns:
 *   {
 *     created: Array<{ index: number, task_id: number, title: string }>,
 *     failed:  Array<{ index: number, title: string, error: { code: string, message: string } }>
 *   }
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import { isoToEpoch } from "../schemas/dates.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { BatchCreateTasksItem, BatchCreateTasksResult } from "../shared/types.js";
import { BATCH_TASK_CAP } from "../shared/constants.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const BatchTaskItemSchema = z
  .object({
    title: z.string().min(1).describe("Task title (required, non-empty)."),
    description: z.string().optional().describe("Task description (optional)."),
    column_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Column id. Falls back to .kanboard.yaml default_column_id."),
    owner_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Owner user id. Falls back to .kanboard.yaml default_owner_id."),
    color_id: z.string().optional().describe("Color identifier (e.g. 'blue', 'red')."),
    date_due: z.union([z.string(), z.number().int(), z.null()]).optional().describe("Due date as ISO 8601 string, Unix epoch seconds (integer), or null to clear."),
    category_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Category id. Falls back to .kanboard.yaml default_category_id."),
    swimlane_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Swimlane id. Falls back to .kanboard.yaml default_swimlane_id."),
    priority: z.number().optional().describe("Task priority."),
    creator_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Creator user id."),
    score: z.number().int().optional().describe("Task complexity score."),
    date_started: z
      .union([z.string(), z.number().int(), z.null()])
      .optional()
      .describe(
        "Start date as ISO 8601 string, Unix epoch seconds (integer), or null to clear.",
      ),
    tags: z.array(z.string()).optional().describe("Array of tag strings."),
    reference: z.string().optional().describe("External reference (e.g. issue URL)."),
  })
  .strict();

export const CreateTasksBatchInput = z
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
    tasks: z
      .array(BatchTaskItemSchema)
      .min(1)
      .max(BATCH_TASK_CAP)
      .describe(
        `Array of task creation inputs. 1..${String(BATCH_TASK_CAP)} items. ` +
          "Non-atomic: partial failure possible. Inspect failed[] for per-task errors.",
      ),
  })
  .strict();

export type CreateTasksBatchInput = z.infer<typeof CreateTasksBatchInput>;

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

interface CreateTasksBatchResult {
  content: { type: "text"; text: string }[];
  structuredContent: BatchCreateTasksResult;
  isError: false;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const createTasksBatchTool = {
  name: "create_tasks_batch",
  description:
    "Bulk-create tasks in a Kanboard project using a single JSON-RPC batch request. " +
    `Accepts 1–${String(BATCH_TASK_CAP)} tasks per call. ` +
    "Non-atomic: partial failure is possible — check failed[] for per-task errors. " +
    "Optional fields (column_id, owner_id, category_id, swimlane_id) fall back to .kanboard.yaml defaults when not provided. " +
    "Returns { created: [...], failed: [...] } — never throws on partial failure.",
  inputSchema: CreateTasksBatchInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<CreateTasksBatchResult> => {
    const input = CreateTasksBatchInput.parse(raw);

    // ── 1. Resolve project context (project_id + yaml defaults) ───────────────
    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined ? { explicitProjectIdentifier: input.project_identifier } : {}),
    });

    // ── 2. Merge yaml defaults into each item ─────────────────────────────────
    //    Item's explicit field takes priority; undefined → yaml default.
    //    date_due is converted from ISO 8601 / epoch number to epoch seconds.
    const mergedItems: BatchCreateTasksItem[] = input.tasks.map((item) => {
      const dateDueEpoch = isoToEpoch(item.date_due, "date_due");
      const dateStartedEpoch = isoToEpoch(item.date_started, "date_started");
      return {
        title: item.title,
        ...(item.description !== undefined ? { description: item.description } : {}),
        ...(item.color_id !== undefined ? { color_id: item.color_id } : {}),
        ...(dateDueEpoch !== undefined && dateDueEpoch !== null ? { date_due: dateDueEpoch } : {}),
        ...(item.priority !== undefined ? { priority: item.priority } : {}),
        ...(item.creator_id !== undefined ? { creator_id: item.creator_id } : {}),
        ...(item.score !== undefined ? { score: item.score } : {}),
        ...(dateStartedEpoch !== undefined && dateStartedEpoch !== null
          ? { date_started: dateStartedEpoch }
          : {}),
        ...(item.tags !== undefined ? { tags: item.tags } : {}),
        ...(item.reference !== undefined ? { reference: item.reference } : {}),
        // Apply yaml defaults for nullable FK fields
        column_id: item.column_id ?? ctx.defaults.columnId,
        owner_id: item.owner_id ?? ctx.defaults.ownerId,
        category_id: item.category_id ?? ctx.defaults.categoryId,
        swimlane_id: item.swimlane_id ?? ctx.defaults.swimlaneId,
      };
    });

    // ── 3. Call handler — partial failure is handled inside, NEVER throws ──────
    //    Transport-level failures (HTTP error, network, timeout) DO throw —
    //    those are propagated as-is (AuthError, KanboardApiError, TimeoutError).
    const result = await deps.handler.createTasksBatch(ctx.projectId, mergedItems);

    // ── 4. Shape MCP response — isError: false even on partial failure ─────────
    const total = input.tasks.length;
    const createdCount = result.created.length;
    const failedCount = result.failed.length;

    const summaryText =
      failedCount === 0
        ? `Created ${String(createdCount)} of ${String(total)} tasks.`
        : `Created ${String(createdCount)} of ${String(total)} tasks; ${String(failedCount)} failed.`;

    return {
      content: [{ type: "text", text: summaryText }],
      structuredContent: result,
      isError: false,
    };
  },
};
