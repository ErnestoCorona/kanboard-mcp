/**
 * Zod schema for the Kanboard Category entity.
 *
 * Covers: getAllCategories response.
 *
 * @well-known fields: id, project_id, name, color_id.
 *
 * @permissively-included fields: description — may be included in some
 * Kanboard versions but not documented consistently.
 *
 * @module schemas/category
 */

import { z } from "zod";
import { numericId } from "./common.js";
import type { Category } from "../shared/types.js";

/**
 * Zod schema for Kanboard Category.
 * Output type matches {@link Category} from `src/shared/types.ts`.
 */
export const CategorySchema = z
  .object({
    // Primary key
    id: numericId,

    // Required FK
    project_id: numericId,

    // Core fields
    name: z.string(),

    // color_id: optional in some contexts (may not be set)
    color_id: z.string().optional().default(""),

    // Permissively-included
    description: z.string().optional(),
  })
  .passthrough()
  .transform(
    (data): Category => ({
      id: data.id,
      project_id: data.project_id,
      name: data.name,
      // Zod .default() guarantees color_id is defined
      color_id: data.color_id,
    }),
  );
