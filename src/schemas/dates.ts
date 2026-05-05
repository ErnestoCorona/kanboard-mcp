/**
 * Input-direction date conversion for Kanboard JSON-RPC API.
 *
 * Kanboard expects Unix epoch **seconds** (integer) for all date inputs.
 * MCP tool inputs accept ISO 8601 strings (from the LLM) or epoch numbers
 * (passthrough). This module converts between the two.
 *
 * @module schemas/dates
 */

import { ValidationError } from "../shared/errors.js";

/**
 * Converts a tool input date value into Unix epoch seconds for the
 * Kanboard JSON-RPC API.
 *
 * Behavior:
 * - `undefined`  → `undefined`  (field omitted from the request entirely)
 * - `null`       → `null`       (Kanboard accepts null to clear date fields)
 * - `number`     → validated positive integer, returned as-is
 * - `string`     → parsed as ISO 8601 via `new Date(s)`; if invalid → throws
 *                  `ValidationError`; if valid → returns `Math.floor(ms / 1000)`
 *
 * @param input - ISO 8601 string, epoch number, null, or undefined.
 * @param fieldName - Field name used in ValidationError messages.
 * @returns Epoch seconds (number), null, or undefined.
 * @throws {ValidationError} When the input is an unrecognised or invalid string.
 */
export function isoToEpoch(
  input: string | number | null | undefined,
  fieldName = "date",
): number | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;

  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new ValidationError(
        "isoToEpoch",
        `Invalid epoch value for field '${fieldName}': must be a non-negative finite number, got ${String(input)}.`,
      );
    }
    return input;
  }

  // string path — parse as ISO 8601
  const ms = new Date(input).getTime();
  if (Number.isNaN(ms)) {
    throw new ValidationError(
      "isoToEpoch",
      `Invalid date string for field '${fieldName}': '${input}' is not a valid ISO 8601 date.`,
    );
  }
  return Math.floor(ms / 1000);
}
