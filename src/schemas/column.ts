/**
 * Zod schema for the Kanboard Column entity.
 *
 * Covers: getColumns response.
 *
 * @well-known fields: id, project_id, title, position, task_limit,
 * description, hide_in_dashboard.
 *
 * @module schemas/column
 */

import { z } from "zod";
import { kanboardBoolean, numericId } from "./common.js";
import type { Column } from "../shared/types.js";

/**
 * Zod schema for Kanboard Column.
 * Output type matches {@link Column} from `src/shared/types.ts`.
 */
export const ColumnSchema = z
  .object({
    // Primary key
    id: numericId,

    // Required FK
    project_id: numericId,

    // Core fields
    title: z.string(),
    position: z.coerce.number().optional().default(0),

    // task_limit: 0 = unlimited
    task_limit: z.coerce.number().optional().default(0),

    // Optional text
    description: z.string().optional().default(""),

    // hide_in_dashboard: boolean-ish from Kanboard
    hide_in_dashboard: kanboardBoolean,
  })
  .passthrough()
  .transform(
    (data): Column => ({
      id: data.id,
      project_id: data.project_id,
      title: data.title,
      // Zod .default() guarantees these are defined
      position: data.position,
      task_limit: data.task_limit,
      description: data.description,
      hide_in_dashboard: data.hide_in_dashboard,
    }),
  );
