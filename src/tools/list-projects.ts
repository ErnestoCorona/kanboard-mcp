/**
 * list_projects — List Kanboard projects where the authenticated user is a member.
 *
 * No input required. Returns the user-scoped project list via getMyProjects().
 * FR-03: wraps handler.getMyProjects(); list returning false → API_ERROR.
 */

import { z } from "zod";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import type { Project } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const ListProjectsInput = z.object({}).strict();
export type ListProjectsInput = z.infer<typeof ListProjectsInput>;

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

interface ListProjectsResult {
  content: { type: "text"; text: string }[];
  structuredContent: { projects: Project[] };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const listProjectsTool = {
  name: "list_projects",
  description:
    "Returns the projects where the authenticated user is a member. " +
    "Does not list projects in the Kanboard instance that the user has no access to. " +
    "Returns an array of project objects with id, name, identifier, and status.",
  inputSchema: ListProjectsInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<ListProjectsResult> => {
    const input = ListProjectsInput.parse(raw);
    void input; // no fields — parse only for strict validation

    const projects = await deps.handler.getMyProjects();
    return {
      content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
      structuredContent: { projects },
    };
  },
};
