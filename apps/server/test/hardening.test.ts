// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("hard");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { runScheduledBackup } = await import("../src/modules/admin/backup");
const { SESSION_COOKIE, createSession, deleteExpiredSessions } =
  await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

async function login(email: string, password: string) {
  return app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
}

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string {
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      email: "user@test.local",
      name: "Ugo Utente",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("vecchia-password"),
    },
  });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("cambio password", () => {
  it("rejects a wrong current password", async () => {
    const session = cookieOf(await login("user@test.local", "vecchia-password"));
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: session },
      payload: { currentPassword: "sbagliata", newPassword: "nuova-password-1" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("changes the password and revokes the other sessions only", async () => {
    const sessionA = cookieOf(await login("user@test.local", "vecchia-password"));
    const sessionB = cookieOf(await login("user@test.local", "vecchia-password"));

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: sessionA },
      payload: { currentPassword: "vecchia-password", newPassword: "nuova-password-1" },
    });
    expect(changed.statusCode).toBe(204);

    // La sessione corrente resta valida, l'altra è stata revocata.
    const meA = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: sessionA },
    });
    expect(meA.statusCode).toBe(200);
    const meB = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: sessionB },
    });
    expect(meB.statusCode).toBe(401);

    // La vecchia password non funziona più, la nuova sì.
    expect((await login("user@test.local", "vecchia-password")).statusCode).toBe(401);
    expect((await login("user@test.local", "nuova-password-1")).statusCode).toBe(200);
  });

  it("logout-others keeps only the current session", async () => {
    const sessionA = cookieOf(await login("user@test.local", "nuova-password-1"));
    const sessionB = cookieOf(await login("user@test.local", "nuova-password-1"));

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout-others",
      headers: { cookie: sessionB },
    });
    expect(response.statusCode).toBe(204);

    expect(
      (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: sessionB } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: sessionA } }))
        .statusCode,
    ).toBe(401);
  });
});

describe("security headers e rate limiting", () => {
  it("helmet sets baseline security headers", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBeDefined();
  });

  it("login is rate limited after too many attempts", async () => {
    let limited = false;
    // Il limite (default 10/15min) conta anche i login dei test precedenti.
    for (let attempt = 0; attempt < 12 && !limited; attempt += 1) {
      const response = await login("user@test.local", "password-errata!");
      if (response.statusCode === 429) {
        limited = true;
        expect(response.json().error).toBe("RATE_LIMITED");
      } else {
        expect(response.statusCode).toBe(401);
      }
    }
    expect(limited).toBe(true);
  });
});

describe("backup automatico", () => {
  it("creates one backup per day (idempotent) with a valid zip", async () => {
    const first = await runScheduledBackup();
    expect(first).not.toBeNull();
    const bytes = readFileSync(first!);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    const second = await runScheduledBackup();
    expect(second).toBeNull(); // il backup di oggi esiste già
  });

  it("retention deletes backups older than the configured days", async () => {
    const oldFile = path.join(process.env.BACKUPS_DIR!, "kancrm-backup-2020-01-01.zip");
    writeFileSync(oldFile, "finto backup vecchio");
    const past = new Date("2020-01-01T00:00:00Z");
    utimesSync(oldFile, past, past);

    await runScheduledBackup();
    const remaining = readdirSync(process.env.BACKUPS_DIR!);
    expect(remaining).not.toContain("kancrm-backup-2020-01-01.zip");
  });
});

describe("pulizia sessioni scadute (B4)", () => {
  it("elimina le sessioni scadute e conserva quelle valide", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: "user@test.local" } });
    const valid = await createSession(user.id);
    const stale = await createSession(user.id);
    // Rendo scaduta una delle due.
    await prisma.session.update({
      where: {
        id: (await import("node:crypto")).createHash("sha256").update(stale.token).digest("hex"),
      },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });

    const removed = await deleteExpiredSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
    // La valida resta usabile.
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `${SESSION_COOKIE}=${valid.token}` },
    });
    expect(me.statusCode).toBe(200);
  });
});
