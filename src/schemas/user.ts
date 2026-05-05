/**
 * Zod schema for the Kanboard User entity.
 *
 * Covers: getMe response. (getAllUsers admin-only path was removed in v0.2.6.)
 *
 * @well-known fields: id, username, name, email, role, is_active, is_admin,
 * avatar_path.
 *
 * @permissively-included fields: is_ldap_user, language, timezone,
 * disable_login_form, twofactor_activated, nb_failed_login,
 * lock_expiration_date — returned by Kanboard admin API, may not be in
 * all user contexts.
 *
 * @module schemas/user
 */

import { z } from "zod";
import { epochSeconds, kanboardBoolean, numericId } from "./common.js";
import type { User } from "../shared/types.js";

/**
 * Zod schema for Kanboard User.
 * Output type matches {@link User} from `src/shared/types.ts`.
 */
export const UserSchema = z
  .object({
    // Primary key
    id: numericId,

    // Core fields
    username: z.string(),
    name: z.string().optional().default(""),
    email: z.string().optional().default(""),

    // Role string: app-admin | app-manager | app-user
    role: z.string().optional().default("app-user"),

    // Boolean flags
    is_active: kanboardBoolean,
    is_admin: kanboardBoolean.optional().default(false),

    // Avatar
    avatar_path: z.string().nullable().optional(),

    // Permissively-included fields
    is_ldap_user: kanboardBoolean.optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    disable_login_form: kanboardBoolean.optional(),
    twofactor_activated: kanboardBoolean.optional(),
    nb_failed_login: z.coerce.number().optional(),
    lock_expiration_date: epochSeconds.optional(),
  })
  .passthrough()
  .transform(
    (data): User => ({
      id: data.id,
      username: data.username,
      // Zod .default() guarantees these are defined
      name: data.name,
      email: data.email,
      role: data.role,
      is_active: data.is_active,
      is_admin: data.is_admin,
      // avatar_path is nullable optional — fall back to null
      avatar_path: data.avatar_path ?? null,
    }),
  );
