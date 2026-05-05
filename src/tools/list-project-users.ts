/**
 * list_project_users — List the members of a Kanboard project.
 *
 * Wraps `handler.getProjectUsers(projectId)`. Replaces the v0.2.5 `list_users`
 * tool, which called the admin-only `getAllUsers` and broke for non-admin
 * callers (HTTP 403).
 *
 * Project resolved via resolveProjectContext (explicit > yaml > ConfigError).
 * Returns an array of `{ user_id, username }` pairs sorted by user_id.
 */

import { z } from "zod";
import { resolveProjectContext } from "./kanboard-context.js";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { ProjectMember } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListProjectUsersInput = z
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

export type ListProjectUsersInput = z.infer<typeof ListProjectUsersInput>;

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

interface ListProjectUsersResult {
  content: { type: "text"; text: string }[];
  structuredContent: { users: ProjectMember[] };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const listProjectUsersTool = {
  name: "list_project_users",
  description:
    "List the members of a Kanboard project (user_id + username pairs). " +
    "Provide project_id or project_identifier, or configure .kanboard.yaml in your project root. " +
    "Works for any user who can see the project — does not require admin permissions. " +
    "Use the returned user_ids to assign tasks (create_task owner_id), add comments, etc.",
  inputSchema: ListProjectUsersInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListProjectUsersResult> => {
    const input = ListProjectUsersInput.parse(raw);

    const ctx = await resolveProjectContext(deps.handler, {
      ...(input.project_id !== undefined ? { explicitProjectId: input.project_id } : {}),
      ...(input.project_identifier !== undefined
        ? { explicitProjectIdentifier: input.project_identifier }
        : {}),
    });

    const users = await deps.handler.getProjectUsers(ctx.projectId);
    return {
      content: [{ type: "text", text: JSON.stringify(users, null, 2) }],
      structuredContent: { users },
    };
  },
};
