/**
 * add_project_user — Add a user to a Kanboard project with the given role.
 *
 * FR-06: wraps handler.addProjectUser(input).
 * Mutation returning false → API_ERROR (thrown by handler).
 * Default role is "project-member".
 */

import { z } from "zod";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const AddProjectUserInput = z
  .object({
    project_id: z.number().int().positive().describe("Numeric project id."),
    user_id: z.number().int().positive().describe("Numeric user id to add to the project."),
    role: z
      .enum(["project-manager", "project-member", "project-viewer"])
      .default("project-member")
      .describe(
        "Role to assign: 'project-manager', 'project-member' (default), or 'project-viewer'.",
      ),
  })
  .strict();

export type AddProjectUserInput = z.infer<typeof AddProjectUserInput>;

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

interface AddProjectUserResult {
  content: { type: "text"; text: string }[];
  structuredContent: {
    user_id: number;
    project_id: number;
    role: "project-manager" | "project-member" | "project-viewer";
  };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const addProjectUserTool = {
  name: "add_project_user",
  description:
    "Add a user to a Kanboard project with the given role. " +
    "Role defaults to 'project-member' if not specified. " +
    "Use list_project_users to find user ids and list_projects to find project ids.",
  inputSchema: AddProjectUserInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<AddProjectUserResult> => {
    const input = AddProjectUserInput.parse(raw);

    await deps.handler.addProjectUser({
      project_id: input.project_id,
      user_id: input.user_id,
      role: input.role,
    });

    return {
      content: [
        {
          type: "text",
          text: `User ${String(input.user_id)} added to project ${String(input.project_id)} as ${input.role}.`,
        },
      ],
      structuredContent: {
        user_id: input.user_id,
        project_id: input.project_id,
        role: input.role,
      },
    };
  },
};
