/**
 * Zod schema for the Kanboard Subtask entity.
 *
 * Covers: getAllSubtasks, getSubtask responses.
 *
 * @well-known fields: id, task_id, title, status (0=todo/1=in-progress/2=done),
 * user_id (nullable FK), time_estimated, time_spent, position.
 *
 * @module schemas/subtask
 */

import { z } from "zod";
import { nullableForeignKey, numericId } from "./common.js";
import type { Subtask } from "../shared/types.js";

/**
 * Zod schema for Kanboard Subtask.
 * Output type matches {@link Subtask} from `src/shared/types.ts`.
 */
export const SubtaskSchema = z
  .object({
    // Primary key
    id: numericId,

    // Required FK
    task_id: numericId,

    // Core fields
    title: z.string(),

    // status: 0 = todo, 1 = in-progress, 2 = done
    status: z.coerce.number().int().min(0).max(2).optional().default(0),

    // Nullable FK: user assigned to this subtask
    user_id: nullableForeignKey,

    // Time tracking (in hours, typically)
    time_estimated: z.coerce.number().optional().default(0),
    time_spent: z.coerce.number().optional().default(0),

    // Position within the task's subtask list
    position: z.coerce.number().optional().default(0),
  })
  .passthrough()
  .transform(
    (data): Subtask => ({
      id: data.id,
      task_id: data.task_id,
      title: data.title,
      // Zod .default() guarantees these are defined
      status: data.status,
      user_id: data.user_id,
      time_estimated: data.time_estimated,
      time_spent: data.time_spent,
    }),
  );
