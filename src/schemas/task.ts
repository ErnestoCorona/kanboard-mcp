/**
 * Zod schema for the Kanboard Task entity.
 *
 * Covers: getTask, getAllTasks, searchTasks, getOverdueTasks,
 * getOverdueTasksByProject, getMyOverdueTasks responses.
 *
 * @well-known fields: id, project_id, title, description, status,
 * column_id, swimlane_id, owner_id, creator_id, category_id, color_id,
 * position, priority, score, reference, tags, date_creation,
 * date_modification, date_due, date_started, date_moved, date_completed, url.
 *
 * @permissively-included fields: recurrence_* fields, nb_* counters,
 * time_estimated, time_spent — returned by Kanboard but not always documented.
 *
 * @module schemas/task
 */

import { z } from "zod";
import {
  epochSeconds,
  kanboardBoolean,
  nullableForeignKey,
  numericId,
} from "./common.js";
import type { Task } from "../shared/types.js";

// Fallback ISO string for required date fields that returned 0/null
const EPOCH_ZERO_ISO = new Date(0).toISOString();

/**
 * Zod schema for Kanboard Task.
 * Output type matches {@link Task} from `src/shared/types.ts`.
 */
export const TaskSchema = z
  .object({
    // Primary key
    id: numericId,

    // Required FK (not nullable — every task has a project)
    project_id: numericId,

    // Core fields
    title: z.string(),
    description: z.string().optional().default(""),

    // is_active in Kanboard terms → maps to status (boolean)
    is_active: kanboardBoolean,

    // Nullable foreign keys
    column_id: nullableForeignKey,
    swimlane_id: nullableForeignKey,
    owner_id: nullableForeignKey,
    creator_id: nullableForeignKey,
    category_id: nullableForeignKey,

    // Non-nullable basic fields with defaults
    color_id: z.string().optional().default("blue"),
    position: z.coerce.number().optional().default(0),
    priority: z.coerce.number().optional().default(0),
    score: z.coerce.number().optional().default(0),
    reference: z.string().optional().default(""),

    // Tags: Kanboard may return as array of strings or empty array
    tags: z.array(z.string()).optional().default([]),

    // Dates (epoch seconds → ISO)
    date_creation: epochSeconds,
    date_modification: epochSeconds,
    date_due: epochSeconds,
    date_started: epochSeconds,
    date_moved: epochSeconds,
    date_completed: epochSeconds,

    // URL
    url: z.string().optional().default(""),

    // Permissively-included: recurrence fields
    recurrence_status: z.coerce.number().optional().default(0),
    recurrence_trigger: z.coerce.number().optional().default(0),
    recurrence_factor: z.coerce.number().optional().default(0),
    recurrence_timeframe: z.coerce.number().optional().default(0),
    recurrence_basedate: z.coerce.number().optional().default(0),
    recurrence_parent: nullableForeignKey.optional(),
    recurrence_child: nullableForeignKey.optional(),

    // Permissively-included: counters
    nb_subtasks: z.coerce.number().optional().default(0),
    nb_completed_subtasks: z.coerce.number().optional().default(0),
    nb_links: z.coerce.number().optional().default(0),
    nb_comments: z.coerce.number().optional().default(0),
    nb_files: z.coerce.number().optional().default(0),

    // Permissively-included: time tracking
    time_estimated: z.coerce.number().optional().default(0),
    time_spent: z.coerce.number().optional().default(0),
  })
  .passthrough()
  .transform(
    (data): Task => ({
      id: data.id,
      project_id: data.project_id,
      title: data.title,
      // Zod .default() guarantees these are defined
      description: data.description,
      status: data.is_active,
      column_id: data.column_id,
      swimlane_id: data.swimlane_id,
      owner_id: data.owner_id,
      creator_id: data.creator_id,
      category_id: data.category_id,
      color_id: data.color_id,
      position: data.position,
      priority: data.priority,
      score: data.score,
      reference: data.reference,
      tags: data.tags,
      // date_creation and date_modification are "required" per spec but Kanboard
      // can return 0 — fall back to epoch zero ISO string to avoid null in non-nullable field
      date_creation: data.date_creation ?? EPOCH_ZERO_ISO,
      date_modification: data.date_modification ?? EPOCH_ZERO_ISO,
      date_due: data.date_due,
      date_started: data.date_started,
      date_moved: data.date_moved,
      date_completed: data.date_completed,
      url: data.url,
    }),
  );
