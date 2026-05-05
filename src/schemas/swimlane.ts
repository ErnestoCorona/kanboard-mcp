/**
 * Zod schema for the Kanboard Swimlane entity.
 *
 * Covers: getActiveSwimlanes, getAllSwimlanes responses.
 *
 * @well-known fields: id, project_id, name, description, position, is_active.
 *
 * @permissively-included fields: task_limit — may be present in newer
 * Kanboard versions but not documented consistently.
 *
 * @module schemas/swimlane
 */

import { z } from "zod";
import { kanboardBoolean, numericId } from "./common.js";
import type { Swimlane } from "../shared/types.js";

/**
 * Zod schema for Kanboard Swimlane.
 * Output type matches {@link Swimlane} from `src/shared/types.ts`.
 */
export const SwimlaneSchema = z
  .object({
    // Primary key
    id: numericId,

    // Required FK
    project_id: numericId,

    // Core fields
    name: z.string(),
    description: z.string().optional().default(""),
    position: z.coerce.number().optional().default(0),

    // Boolean (active/disabled)
    is_active: kanboardBoolean,

    // Permissively-included
    task_limit: z.coerce.number().optional(),
  })
  .passthrough()
  .transform(
    (data): Swimlane => ({
      id: data.id,
      project_id: data.project_id,
      name: data.name,
      // Zod .default() guarantees these are defined
      description: data.description,
      position: data.position,
      is_active: data.is_active,
    }),
  );
