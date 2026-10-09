import { describe, expect, it } from "vitest";
import { loginSchema } from "./auth";

describe("loginSchema", () => {
  it("accepts a valid payload", () => {
    const result = loginSchema.safeParse({
      email: "mario.rossi@example.com",
      password: "s3cret-password",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "s3cret-password" });
    expect(result.success).toBe(false);
  });

  it("rejects a short password", () => {
    const result = loginSchema.safeParse({ email: "mario.rossi@example.com", password: "short" });
    expect(result.success).toBe(false);
  });
});
