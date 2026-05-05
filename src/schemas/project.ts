/**
 * Zod schema for the Kanboard Project entity.
 *
 * Covers: getAllProjects, getProjectById, getProjectByName,
 * getProjectByIdentifier responses.
 *
 * @well-known fields: id, name, identifier, description, is_active,
 * is_public, is_private, token, owner_id, default_swimlane,
 * show_default_swimlane, start_date, end_date, url.
 *
 * @permissively-included fields: priority_default, priority_start,
 * priority_end, email, predefined_email_subjects, per_swimlane_task_limits,
 * task_limit, enable_global_tags — included because Kanboard returns them
 * in practice, but docs may not reflect every live API version.
 *
 * @module schemas/project
 */

import { z } from "zod";
import {
  epochSeconds,
  kanboardBoolean,
  nullableForeignKey,
  nullableString,
  numericId,
} from "./common.js";
import type { Project, ProjectUrl } from "../shared/types.js";

/**
 * Zod schema for Kanboard Project.
 * Output type matches {@link Project} from `src/shared/types.ts`.
 */
export const ProjectSchema = z
  .object({
    // Primary key
    id: numericId,

    // Core fields — all have defaults so transform can access them directly
    name: z.string(),
    identifier: z.string().optional().default(""),
    // Kanboard returns null when no description is set — nullableString handles null/""
    description: nullableString.optional(),

    // Boolean flags
    is_active: kanboardBoolean,
    is_public: kanboardBoolean,
    is_private: kanboardBoolean,

    // Token (optional — only returned in some contexts)
    token: z.string().optional().default(""),

    // Foreign keys
    owner_id: nullableForeignKey,

    // Swimlane info
    default_swimlane: z.string().optional().default(""),
    show_default_swimlane: kanboardBoolean.optional().default(true),

    // Dates (epoch seconds → ISO)
    start_date: epochSeconds,
    end_date: epochSeconds,

    // Kanboard v1.2+ returns an object {board, list} — older versions may return a plain string
    url: z
      .union([
        z.object({ board: z.string(), list: z.string() }).passthrough(),
        z.string(),
      ])
      .optional(),

    // Permissively-included numeric config fields
    priority_default: z.coerce.number().optional().default(0),
    priority_start: z.coerce.number().optional().default(0),
    priority_end: z.coerce.number().optional().default(0),
    email: nullableString.optional(),
    task_limit: z.coerce.number().optional().default(0),
    per_swimlane_task_limits: kanboardBoolean.optional(),
    enable_global_tags: kanboardBoolean.optional(),
    predefined_email_subjects: nullableString.optional(),
  })
  .passthrough()
  .transform(
    (data): Project => ({
      id: data.id,
      name: data.name,
      identifier: data.identifier,
      // null → "" to preserve the Project type contract (description is always string)
      description: data.description ?? "",
      is_active: data.is_active,
      is_public: data.is_public,
      is_private: data.is_private,
      token: data.token,
      owner_id: data.owner_id,
      default_swimlane: data.default_swimlane,
      show_default_swimlane: data.show_default_swimlane,
      start_date: data.start_date,
      end_date: data.end_date,
      // Pass through as-is: object {board,list} or plain string; "" when absent
      url: (data.url as ProjectUrl | string | undefined) ?? "",
    }),
  );
