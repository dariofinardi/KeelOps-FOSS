// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("m1-auth");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  expect(cookie).toBeDefined();
  return `${SESSION_COOKIE}=${cookie!.value}`;
}

async function login(email: string, password: string) {
  return app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
}

beforeAll(async () => {
  const passwordHash = await hashPassword("admin1234");
  await prisma.user.create({
    data: { email: "admin@test.local", name: "Admin", role: UserRole.ADMIN, adminUntil: new Date("2099-01-01"), passwordHash },
  });
  await prisma.user.create({
    data: {
      email: "member@test.local",
      name: "Member",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("member1234"),
    },
  });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("auth", () => {
  it("rejects wrong credentials", async () => {
    const response = await login("admin@test.local", "wrong-password");
    expect(response.statusCode).toBe(401);
  });

  it("logs in and returns the current user via /me", async () => {
    const loginResponse = await login("admin@test.local", "admin1234");
    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json().role).toBe("ADMIN");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookieOf(loginResponse) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe("admin@test.local");
  });

  it("logout invalidates the session", async () => {
    const loginResponse = await login("admin@test.local", "admin1234");
    const cookie = cookieOf(loginResponse);
    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

describe("guard", () => {
  it("blocks unauthenticated access to protected api routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/users" });
    expect(response.statusCode).toBe(401);
  });

  it("blocks non-admin users from admin routes", async () => {
    const loginResponse = await login("member@test.local", "member1234");
    const response = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { cookie: cookieOf(loginResponse) },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("admin users & groups", () => {
  let adminCookie: string;

  beforeAll(async () => {
    adminCookie = cookieOf(await login("admin@test.local", "admin1234"));
  });

  it("creates a user and lists it", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: adminCookie },
      payload: {
        email: "nuovo@test.local",
        name: "Nuovo Utente",
        role: "MEMBER",
        password: "password123",
      },
    });
    expect(created.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: adminCookie },
      payload: { email: "nuovo@test.local", name: "Doppione", password: "password123" },
    });
    expect(duplicate.statusCode).toBe(409);

    const list = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { cookie: adminCookie },
    });
    const emails = list.json().map((u: { email: string }) => u.email);
    expect(emails).toContain("nuovo@test.local");
  });

  it("rejects invalid payloads with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: adminCookie },
      payload: { email: "non-email", name: "", password: "short" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("VALIDATION_ERROR");
  });

  it("prevents an admin from deactivating themselves", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie },
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/api/users/${me.json().id}`,
      headers: { cookie: adminCookie },
      payload: { isActive: false },
    });
    expect(response.statusCode).toBe(400);
  });

  it("deactivating a user kills their sessions", async () => {
    const memberLogin = await login("member@test.local", "member1234");
    const memberCookie = cookieOf(memberLogin);
    const memberId = memberLogin.json().id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/users/${memberId}`,
      headers: { cookie: adminCookie },
      payload: { isActive: false },
    });
    expect(patch.statusCode).toBe(200);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: memberCookie },
    });
    expect(me.statusCode).toBe(401);
  });

  it("manages groups and membership", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { cookie: adminCookie },
      payload: { name: "Commerciale" },
    });
    expect(created.statusCode).toBe(201);
    const groupId = created.json().id;

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie },
    });
    const updated = await app.inject({
      method: "PUT",
      url: `/api/groups/${groupId}/members`,
      headers: { cookie: adminCookie },
      payload: { userIds: [me.json().id] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().members).toHaveLength(1);
    expect(updated.json().members[0].email).toBe("admin@test.local");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/groups/${groupId}`,
      headers: { cookie: adminCookie },
    });
    expect(deleted.statusCode).toBe(204);
  });
});
