/**
 * Unit tests for src/schemas/user.ts
 */

import { describe, it, expect } from "vitest";
import { UserSchema } from "../../../src/schemas/user.js";

const fullUserFixture = {
  id: "7",
  username: "ernesto.corona",
  name: "Ernesto Corona",
  email: "ernesto.corona@example.com",
  role: "app-admin",
  is_active: "1",
  is_admin: "1",
  avatar_path: null,
};

describe("UserSchema — happy path", () => {
  it("parses full user fixture", () => {
    const result = UserSchema.parse(fullUserFixture);
    expect(result.id).toBe(7);
    expect(result.username).toBe("ernesto.corona");
    expect(result.name).toBe("Ernesto Corona");
    expect(result.email).toBe("ernesto.corona@example.com");
    expect(result.role).toBe("app-admin");
    expect(result.is_active).toBe(true);
    expect(result.is_admin).toBe(true);
    expect(result.avatar_path).toBeNull();
  });

  it("is_active '0' → false", () => {
    const result = UserSchema.parse({ ...fullUserFixture, is_active: "0" });
    expect(result.is_active).toBe(false);
  });

  it("is_admin '0' → false", () => {
    const result = UserSchema.parse({ ...fullUserFixture, is_admin: "0" });
    expect(result.is_admin).toBe(false);
  });

  it("is_active '1' → true", () => {
    const result = UserSchema.parse({ ...fullUserFixture, is_active: "1" });
    expect(result.is_active).toBe(true);
  });

  it("is_admin '1' → true", () => {
    const result = UserSchema.parse({ ...fullUserFixture, is_admin: "1" });
    expect(result.is_admin).toBe(true);
  });
});

describe("UserSchema — kanboardBoolean for boolean flags", () => {
  it("is_active: true → true", () => {
    const result = UserSchema.parse({ ...fullUserFixture, is_active: true });
    expect(result.is_active).toBe(true);
  });

  it("is_active: 1 → true", () => {
    const result = UserSchema.parse({ ...fullUserFixture, is_active: 1 });
    expect(result.is_active).toBe(true);
  });

  it("is_active: 0 → false", () => {
    const result = UserSchema.parse({ ...fullUserFixture, is_active: 0 });
    expect(result.is_active).toBe(false);
  });
});

describe("UserSchema — optional fields", () => {
  it("avatar_path present → included in output", () => {
    const result = UserSchema.parse({
      ...fullUserFixture,
      avatar_path: "avatars/ernesto.jpg",
    });
    expect(result.avatar_path).toBe("avatars/ernesto.jpg");
  });

  it("missing name → defaults to empty string", () => {
    const withoutName = { ...fullUserFixture };
    delete (withoutName as Record<string, unknown>).name;
    const result = UserSchema.parse(withoutName);
    expect(result.name).toBe("");
  });

  it("missing email → defaults to empty string", () => {
    const withoutEmail = { ...fullUserFixture };
    delete (withoutEmail as Record<string, unknown>).email;
    const result = UserSchema.parse(withoutEmail);
    expect(result.email).toBe("");
  });

  it("role defaults to app-user when missing", () => {
    const withoutRole = { ...fullUserFixture };
    delete (withoutRole as Record<string, unknown>).role;
    const result = UserSchema.parse(withoutRole);
    expect(result.role).toBe("app-user");
  });
});

describe("UserSchema — permissively-included fields", () => {
  it("parses user with LDAP/2FA fields without throwing", () => {
    const ldapUser = {
      ...fullUserFixture,
      is_ldap_user: "1",
      language: "en_US",
      timezone: "Europe/Berlin",
      disable_login_form: "0",
      twofactor_activated: "0",
      nb_failed_login: "0",
    };
    expect(() => UserSchema.parse(ldapUser)).not.toThrow();
  });
});

describe("UserSchema — passthrough", () => {
  it("ignores unknown fields", () => {
    expect(() =>
      UserSchema.parse({ ...fullUserFixture, future_field: "test" })
    ).not.toThrow();
  });
});
