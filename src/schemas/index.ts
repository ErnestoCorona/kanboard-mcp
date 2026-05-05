/**
 * Barrel re-export for all Kanboard Zod schemas and common transforms.
 *
 * Import from this module to get everything:
 * ```ts
 * import { ProjectSchema, TaskSchema, epochSeconds } from '../schemas/index.js';
 * ```
 *
 * @module schemas
 */

// Common transforms
export {
  epochSeconds,
  nullableForeignKey,
  numericId,
  kanboardBoolean,
  nullableString,
} from "./common.js";
export type {
  EpochSecondsOutput,
  NullableForeignKeyOutput,
  NumericIdOutput,
  KanboardBooleanOutput,
} from "./common.js";

// Input-direction date conversion
export { isoToEpoch } from "./dates.js";

// Entity schemas
export { ProjectSchema } from "./project.js";
export { TaskSchema } from "./task.js";
export { SubtaskSchema } from "./subtask.js";
export { CommentSchema } from "./comment.js";
export { ColumnSchema } from "./column.js";
export { CategorySchema } from "./category.js";
export { SwimlaneSchema } from "./swimlane.js";
export { UserSchema } from "./user.js";
export { FileAttachmentSchema } from "./file.js";
