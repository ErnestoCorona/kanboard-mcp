/**
 * Shared confirm-flag gate for destructive Kanboard MCP tools.
 *
 * Centralises the `confirm: true` enforcement so every destructive verb
 * (delete_*, remove_project_user, delete_swimlane) gates side-effects through
 * the same code path. Belt-and-suspenders: even when the Zod schema already
 * uses `z.literal(true)`, the handler calls this helper as a defensive
 * second check that also surfaces a clear, tool-named ValidationError if
 * a programmatic consumer bypasses Zod entirely.
 *
 * Throws {@link ValidationError} when `confirm` is not strictly the boolean
 * `true`. Returns `void` on success.
 */

import { ValidationError } from "./errors.js";

/**
 * Assert that a destructive operation has been explicitly confirmed.
 *
 * @param toolName - The MCP tool name (e.g. `"delete_task"`) used in the
 *   thrown {@link ValidationError} so the caller knows which tool refused
 *   the operation.
 * @param confirm  - The `confirm` flag passed by the caller. Must be exactly
 *   the boolean `true` — `1`, `"true"`, truthy strings, or `undefined` all
 *   throw.
 * @throws {ValidationError} when `confirm !== true`.
 */
export function assertConfirmed(toolName: string, confirm: boolean): void {
  // Strict identity check via Object.is rather than `!== true`:
  // - keeps the lint rule happy (no boolean-literal compare)
  // - still rejects ANY non-`true` value, including 1, "true", undefined.
  if (!Object.is(confirm, true)) {
    throw new ValidationError(
      toolName,
      `${toolName}: this is a destructive operation — pass confirm: true to proceed.`,
    );
  }
}
