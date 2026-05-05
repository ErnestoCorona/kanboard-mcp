/**
 * Shared Zod transforms for Kanboard JSON-RPC response normalization.
 *
 * Kanboard diverges from BookStack in three key ways:
 * 1. Dates are Unix epoch seconds (integer), not ISO 8601 strings.
 * 2. Integer IDs are often returned as strings ("1", "0").
 * 3. "0" / "" / 0 means "no value" for nullable foreign-key fields.
 *
 * ALL normalization lives here — never in tools or api-client.
 *
 * @module schemas/common
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// epochSeconds
// ---------------------------------------------------------------------------

/**
 * Accepts number | string-of-number | null | "0" | "" and normalizes to
 * ISO 8601 string | null.
 *
 * - 0, "0", "", null → null
 * - Positive integer n → `new Date(n * 1000).toISOString()`
 * - Non-finite or negative → null (lenient: treat as "no date")
 *
 * @well-known Applies to: date_creation, date_modification, date_due,
 * date_started, date_moved, date_completed, date, lock_expiration_date.
 */
export const epochSeconds = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((v): string | null => {
    if (v === null || v === "" || v === "0" || v === 0) return null;
    const n = typeof v === "string" ? Number(v) : v;
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n * 1000).toISOString();
  });

/** Inferred output type from {@link epochSeconds}. */
export type EpochSecondsOutput = z.output<typeof epochSeconds>;

// ---------------------------------------------------------------------------
// nullableForeignKey
// ---------------------------------------------------------------------------

/**
 * Accepts number | string-of-number | "0" | "" | null and normalizes to
 * number | null.
 *
 * - null, "", "0", 0 → null
 * - Positive numeric value → number
 * - Non-finite or negative → null (lenient)
 *
 * @well-known Applies to: category_id, swimlane_id, owner_id, creator_id,
 * recurrence_parent, recurrence_child, user_id (subtask/comment FK context).
 */
export const nullableForeignKey = z
  .union([z.number(), z.string(), z.null()])
  .transform((v): number | null => {
    if (v === null || v === "" || v === "0" || v === 0) return null;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) && n > 0 ? n : null;
  });

/** Inferred output type from {@link nullableForeignKey}. */
export type NullableForeignKeyOutput = z.output<typeof nullableForeignKey>;

// ---------------------------------------------------------------------------
// numericId
// ---------------------------------------------------------------------------

/**
 * Accepts number | string-of-number (REQUIRED primary ID) and normalizes to
 * a positive number. Throws a Zod validation error for 0, negative, or
 * non-numeric input.
 *
 * @well-known Applies to: every primary `id` field in Kanboard entities.
 */
export const numericId = z
  .union([z.number(), z.string()])
  .transform((v, ctx): number => {
    const n = typeof v === "string" ? Number(v) : v;
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected positive numeric ID",
      });
      return z.NEVER;
    }
    return n;
  });

/** Inferred output type from {@link numericId}. */
export type NumericIdOutput = z.output<typeof numericId>;

// ---------------------------------------------------------------------------
// kanboardBoolean
// ---------------------------------------------------------------------------

/**
 * Accepts boolean | 0 | 1 | "0" | "1" and normalizes to boolean.
 *
 * - true, 1, "1" → true
 * - false, 0, "0" → false
 *
 * @well-known Applies to: is_active, is_public, is_private, is_image,
 * hide_in_dashboard, disable_login_form, twofactor_activated, is_ldap_user.
 */
export const kanboardBoolean = z
  .union([
    z.boolean(),
    z.literal(0),
    z.literal(1),
    z.literal("0"),
    z.literal("1"),
  ])
  .transform((v): boolean => v === true || v === 1 || v === "1");

/** Inferred output type from {@link kanboardBoolean}. */
export type KanboardBooleanOutput = z.output<typeof kanboardBoolean>;

// ---------------------------------------------------------------------------
// nullableString
// ---------------------------------------------------------------------------

/**
 * Accepts string | null and normalizes empty string to null.
 * Use for optional text fields that Kanboard may return as "".
 */
export const nullableString = z
  .string()
  .nullable()
  .transform((v): string | null => (v === "" ? null : v));
