/**
 * Zod schema for the Kanboard FileAttachment entity.
 *
 * Covers: createTaskFile, getAllTaskFiles responses.
 *
 * @well-known fields: id, task_id, project_id, name, path, is_image,
 * size, user_id, date.
 *
 * @module schemas/file
 */

import { z } from "zod";
import { epochSeconds, kanboardBoolean, nullableForeignKey, numericId } from "./common.js";
import type { FileAttachment } from "../shared/types.js";

// Fallback ISO string for required date fields that returned 0/null
const EPOCH_ZERO_ISO = new Date(0).toISOString();

/**
 * Zod schema for Kanboard FileAttachment.
 * Output type matches {@link FileAttachment} from `src/shared/types.ts`.
 */
export const FileAttachmentSchema = z
  .object({
    // Primary key
    id: numericId,

    // Required FKs
    task_id: numericId,
    project_id: numericId,

    // File metadata
    name: z.string(),
    path: z.string().optional().default(""),

    // Boolean
    is_image: kanboardBoolean,

    // File size in bytes
    size: z.coerce.number().optional().default(0),

    // Uploader (nullable FK — Kanboard may return "0" if system-uploaded)
    user_id: nullableForeignKey,

    // Date of upload (epoch seconds → ISO)
    date: epochSeconds,
  })
  .passthrough()
  .transform(
    (data): FileAttachment => ({
      id: data.id,
      task_id: data.task_id,
      project_id: data.project_id,
      name: data.name,
      // Zod .default() guarantees path and size are defined
      path: data.path,
      is_image: data.is_image,
      size: data.size,
      user_id: data.user_id,
      // epochSeconds returns string | null; FileAttachment.date is string
      date: data.date ?? EPOCH_ZERO_ISO,
    }),
  );
