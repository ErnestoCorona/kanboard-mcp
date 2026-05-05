/**
 * Zod schema for the Kanboard Comment entity.
 *
 * Covers: createComment, getAllComments responses.
 *
 * @well-known fields: id, task_id, user_id, content, reference, visibility,
 * date_creation, date_modification.
 *
 * @permissively-included fields: name, username, email, avatar_path —
 * returned when comment includes author info (some API contexts).
 *
 * @module schemas/comment
 */

import { z } from "zod";
import { epochSeconds, numericId } from "./common.js";
import type { Comment } from "../shared/types.js";

// Fallback ISO string for required date fields that returned 0/null
const EPOCH_ZERO_ISO = new Date(0).toISOString();

/**
 * Zod schema for Kanboard Comment.
 * Output type matches {@link Comment} from `src/shared/types.ts`.
 */
export const CommentSchema = z
  .object({
    // Primary key
    id: numericId,

    // Required FKs
    task_id: numericId,
    user_id: numericId,

    // Content
    content: z.string().optional().default(""),
    reference: z.string().optional().default(""),

    // Visibility: app-user | app-manager | app-admin
    visibility: z.string().optional().default("app-user"),

    // Dates (epoch seconds → ISO)
    date_creation: epochSeconds,
    date_modification: epochSeconds,

    // Permissively-included author fields
    name: z.string().optional(),
    username: z.string().optional(),
    email: z.string().optional(),
    avatar_path: z.string().nullable().optional(),
  })
  .passthrough()
  .transform(
    (data): Comment => ({
      id: data.id,
      task_id: data.task_id,
      user_id: data.user_id,
      // Zod .default() guarantees these are defined
      content: data.content,
      reference: data.reference,
      visibility: data.visibility,
      // epochSeconds returns string | null; Comment.date_creation is string
      date_creation: data.date_creation ?? EPOCH_ZERO_ISO,
      date_modification: data.date_modification ?? EPOCH_ZERO_ISO,
    }),
  );
