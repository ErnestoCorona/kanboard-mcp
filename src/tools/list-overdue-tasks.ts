/**
 * list_overdue_tasks — List overdue tasks with 3-way scope dispatch.
 *
 * FR-13: Dispatch by `scope` field:
 *   - "mine"    (default) → getMyOverdueTasks()
 *   - "all"               → getOverdueTasks() (global; may require admin token)
 *   - "project"           → getOverdueTasksByProject(project_id)
 *                           Project context resolved via standard precedence chain.
 *
 * Note: getOverdueTasksByUser is NOT exposed by Kanboard JSON-RPC API v1 — that
 * branch is unsupported. Use scope="mine" for current-user overdue tasks.
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Task } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListOverdueTasksInput = z
  .object({
    scope: z
      .enum(["mine", "all", "project"])
      .default("mine")
      .describe(
        'Scope of overdue tasks to return: ' +
          '"mine" (default) = tasks overdue for the current user via getMyOverdueTasks; ' +
          '"all" = all overdue tasks across all projects (admin-level) via getOverdueTasks; ' +
          '"project" = overdue tasks for a specific project (requires project_id or .kanboard.yaml) ' +
          'via getOverdueTasksByProject.',
      ),
    project_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Required when scope="project": Kanboard project id (overrides .kanboard.yaml).'),
    project_identifier: z
      .string()
      .optional()
      .describe(
        'Required when scope="project": Kanboard project identifier string (overrides .kanboard.yaml).',
      ),
  })
  .strict()
  .refine(
    () => {
      // When scope is "project" we need project context — but we allow yaml fallback
      // so we cannot enforce project_id here (yaml might provide it). Allow any combo.
      // When scope is NOT "project", project_id/project_identifier are ignored (not errors).
      return true;
    },
    { message: "Invalid scope/project combination." },
  );

export type ListOverdueTasksInput = z.infer<typeof ListOverdueTasksInput>;

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

interface ListOverdueTasksResult {
  content: { type: "text"; text: string }[];
  structuredContent: { tasks: Task[] };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const listOverdueTasksTool = {
  name: "list_overdue_tasks",
  description:
    'List overdue tasks with configurable scope. ' +
    'scope="mine" (default): overdue tasks for the authenticated user. ' +
    'scope="all": all overdue tasks across all projects (admin token required). ' +
    'scope="project": overdue tasks for a specific project (pass project_id or use .kanboard.yaml). ' +
    'Note: getOverdueTasksByUser is not supported by the Kanboard JSON-RPC API. ' +
    'Returns an empty array when nothing is overdue.',
  inputSchema: ListOverdueTasksInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListOverdueTasksResult> => {
    const input = ListOverdueTasksInput.parse(raw);

    let tasks: Task[];

    switch (input.scope) {
      case "mine": {
        tasks = await deps.handler.getMyOverdueTasks();
        break;
      }

      case "all": {
        tasks = await deps.handler.getOverdueTasks();
        break;
      }

      case "project": {
        // Resolve project context — uses explicit args first, then yaml.
        const ctx = await resolveProjectContext(deps.handler, {
          ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
          ...(input.project_identifier !== undefined
            ? { explicitProjectIdentifier: input.project_identifier }
            : {}),
        });
        tasks = await deps.handler.getOverdueTasksByProject(ctx.projectId);
        break;
      }

      default: {
        // TypeScript exhaustiveness — should never reach here.
        const _exhaustive: never = input.scope;
        throw new Error(`Unknown scope: ${String(_exhaustive)}`);
      }
    }

    const structuredContent = { tasks };

    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  },
};
