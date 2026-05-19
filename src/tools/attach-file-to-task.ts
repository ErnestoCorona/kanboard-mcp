/**
 * attach_file_to_task — Upload a file to a Kanboard task as an attachment.
 *
 * FR-15:
 * - Accepts exactly one of `file_path` (local file) XOR `content_base64` (inline base64).
 * - `project_id` is resolved internally via getTask(task_id) — not accepted as input.
 * - File size (decoded) MUST be ≤ 5,242,880 bytes (5 MB); enforced BEFORE any HTTP call.
 * - Returns { file_id } on success.
 *
 * Cross-field XOR validation runs in the handler (NOT in the schema) so that
 * inputSchema remains a plain ZodObject — the MCP SDK only reads ZodObject.shape.
 *
 * S4: When file_path is given, size is checked via fs.stat() BEFORE base64-encoding.
 *     When content_base64 is given, Buffer.byteLength is checked BEFORE the HTTP call.
 */

import { z } from "zod";
import { promises as fs } from "node:fs";
import type { KanboardHandler } from "../handler/kanboard.js";
import type { Resolvers } from "../handler/resolvers.js";
import { ValidationError, ConfigError } from "../shared/errors.js";
import { FILE_SIZE_CAP_BYTES } from "../shared/constants.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

// NOTE: Do NOT add top-level .refine() to this schema. The MCP SDK
// normalizeObjectSchema() only reads ZodObject.shape; a top-level .refine()
// produces ZodEffects which has no .shape and collapses tools/list to {}.
// Cross-field XOR validation belongs in the handler body instead.
export const AttachFileToTaskInput = z
  .object({
    task_id: z.number().int().positive().describe("ID of the task to attach the file to (required)."),
    filename: z
      .string()
      .min(1)
      .max(255)
      .describe("Filename to store in Kanboard (required)."),
    file_path: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Absolute or relative path to the file to upload. " +
          "Relative paths are resolved against process.cwd(). " +
          "Maximum decoded size: 5 MB (5,242,880 bytes). " +
          "Exactly one of file_path or content_base64 must be provided (not both, not neither).",
      ),
    content_base64: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Base64-encoded file content to upload directly (no local file needed). " +
          "Decoded size must be ≤ 5 MB (5,242,880 bytes). " +
          "Exactly one of file_path or content_base64 must be provided (not both, not neither).",
      ),
  })
  .strict();

export type AttachFileToTaskInput = z.infer<typeof AttachFileToTaskInput>;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface ToolDeps {
  handler: KanboardHandler;
  resolvers: Resolvers;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface AttachFileResult {
  content: { type: "text"; text: string }[];
  structuredContent: { file_id: number };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const attachFileToTaskTool = {
  name: "attach_file_to_task",
  description:
    "Upload a file to a Kanboard task as an attachment. " +
    "Provide either file_path (local file) or content_base64 (inline base64 content) — not both. " +
    "project_id is resolved automatically from the task (no need to provide it). " +
    "Maximum file size: 5 MB (5,242,880 bytes) — larger files return VALIDATION_ERROR " +
    "before any HTTP request is made. " +
    "Returns { file_id } on success.",
  inputSchema: AttachFileToTaskInput,
  handler: async (raw: unknown, deps: ToolDeps): Promise<AttachFileResult> => {
    const parsed = AttachFileToTaskInput.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        "attach_file_to_task",
        parsed.error.issues.map((i) => i.message).join("; "),
        parsed.error.issues,
      );
    }

    const input = parsed.data;

    const hasFilePath = input.file_path !== undefined;
    const hasBase64 = input.content_base64 !== undefined;
    if (hasFilePath === hasBase64) {
      throw new ValidationError(
        "attach_file_to_task",
        "Exactly one of file_path or content_base64 must be provided (not both, not neither).",
        { file_path: input.file_path, content_base64: input.content_base64 !== undefined },
      );
    }

    // ── 1. Resolve project_id from the task itself (FR-15) ────────────────────
    const task = await deps.handler.getTask(input.task_id);
    const project_id = task.project_id;

    // ── 2. Obtain blob_base64 from file_path or content_base64 ───────────────

    let blob_base64: string;
    const filename = input.filename;

    if (input.content_base64 !== undefined) {
      // ── content_base64 path ──────────────────────────────────────────────────
      const decoded_size = Buffer.from(input.content_base64, "base64").byteLength;

      if (decoded_size > FILE_SIZE_CAP_BYTES) {
        throw new ValidationError(
          "attach_file_to_task",
          `attach_file_to_task: content_base64 decoded size exceeds 5 MB cap ` +
            `(actual: ${String(decoded_size)} bytes, limit: ${String(FILE_SIZE_CAP_BYTES)} bytes)`,
          { actual_bytes: decoded_size, limit_bytes: FILE_SIZE_CAP_BYTES },
        );
      }

      blob_base64 = input.content_base64;
    } else if (input.file_path !== undefined) {
      // ── file_path path ───────────────────────────────────────────────────────
      const file_path = input.file_path;

      // 2a. Stat the file — existence check (BEFORE reading, BEFORE base64)
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(file_path);
      } catch (err) {
        const code =
          err instanceof Error && "code" in err
            ? (err as NodeJS.ErrnoException).code
            : undefined;
        if (code === "ENOENT" || code === "EACCES") {
          throw new ConfigError(
            `attach_file_to_task: file_path not found or not readable: ${file_path}`,
            { code, file_path },
          );
        }
        throw err;
      }

      // 2b. Size check BEFORE base64 encoding (cheap fail-fast — S4, FR-15)
      if (stat.size > FILE_SIZE_CAP_BYTES) {
        throw new ValidationError(
          "attach_file_to_task",
          `attach_file_to_task: file exceeds 5 MB cap ` +
            `(actual: ${String(stat.size)} bytes, limit: ${String(FILE_SIZE_CAP_BYTES)} bytes)`,
          { actual_bytes: stat.size, limit_bytes: FILE_SIZE_CAP_BYTES },
        );
      }

      // 2c. Read file
      const buf = await fs.readFile(file_path);

      // 2d. Secondary size check (stat-vs-read race guard)
      if (buf.byteLength > FILE_SIZE_CAP_BYTES) {
        throw new ValidationError(
          "attach_file_to_task",
          `attach_file_to_task: file exceeds 5 MB cap after read ` +
            `(actual: ${String(buf.byteLength)} bytes, limit: ${String(FILE_SIZE_CAP_BYTES)} bytes)`,
          { actual_bytes: buf.byteLength, limit_bytes: FILE_SIZE_CAP_BYTES },
        );
      }

      // 2e. Base64 encode
      blob_base64 = buf.toString("base64");
    } else {
      // This branch is unreachable — the handler-side XOR check above guarantees
      // exactly one of file_path/content_base64 is defined.
      throw new ValidationError(
        "attach_file_to_task",
        "attach_file_to_task: exactly one of file_path or content_base64 must be provided",
      );
    }

    // ── 3. Upload ──────────────────────────────────────────────────────────────
    const file_id = await deps.handler.createTaskFile({
      project_id,
      task_id: input.task_id,
      filename,
      blob_base64,
    });

    return {
      content: [
        {
          type: "text",
          text: `File '${filename}' attached to task ${String(input.task_id)} as file ${String(file_id)}.`,
        },
      ],
      structuredContent: { file_id },
    };
  },
};
