// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

/**
 * **Il freno progressivo sulle password sbagliate** (05/09/2026): i primi due
 * errori non costano, dal terzo l'account si chiude per un tempo che
 * raddoppia fino a 100 minuti, gli amministratori ricevono un'email una
 * volta per episodio, e un amministratore può azzerare tutto da «Utenti».
 */
const { tempDir } = prepareTestDb("lockout");
// Qui si sbaglia apposta molte volte: il limitatore per indirizzo del login non è in prova.
process.env.LOGIN_RATE_LIMIT_MAX = "1000";
// La posta è accesa come nel test del connettore: l'avviso agli admin parte da lì.
process.env.MAILER_HOST = "smtp.example";
process.env.APP_BASE_URL = "https://keelops.example";

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { lockSeconds, attesa, LOCK_CAP_SECONDS } = await import("../src/modules/auth/lockout");
const { flushMail, setMailTransport } = await import("../src/modules/mail/service");
const { memoryTransport } = await import("../src/modules/mail/transports");

let app: Awaited<ReturnType<typeof buildApp>>;
let utenteId: string;
let adminCookie: string;
const posta = memoryTransport();

const login = (email: string, password: string) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });

beforeAll(async () => {
  app = await buildApp();
  setMailTransport(posta);
  const passwordHash = await hashPassword("giusta-1234");
  utenteId = (
    await prisma.user.create({
      data: { email: "lia@x.local", name: "Lia Locka", role: UserRole.MEMBER, passwordHash },
    })
  ).id;
  await prisma.user.create({
    data: { email: "admin@x.local", name: "Ada Admin", role: UserRole.ADMIN, passwordHash },
  });
  const accesso = await login("admin@x.local", "giusta-1234");
  adminCookie = accesso.headers["set-cookie"]!.toString().split(";")[0]!;
  // «Utenti» è terreno da amministratore elevato
  await app.inject({ method: "POST", url: "/api/auth/elevate", headers: { cookie: adminCookie } });
});

afterAll(async () => {
  setMailTransport(null);
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  posta.sent.length = 0;
  await prisma.user.update({
    where: { id: utenteId },
    data: { failedPasswordAttempts: 0, passwordLockedUntil: null, lockoutAlertedAt: null },
  });
});

describe("la regola", () => {
  it("niente per due errori, poi 30 s che raddoppiano fino a 100 minuti", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20].map(lockSeconds)).toEqual([
      0, 0, 0, 30, 60, 120, 240, 480, 960, 1920, 3840, 6000, 6000,
    ]);
    expect(LOCK_CAP_SECONDS).toBe(6000);
  });

  it("l'attesa si dice in secondi sotto il minuto, in minuti sopra", () => {
    const ora = new Date("2026-09-05T10:00:00Z");
    expect(attesa(new Date("2026-09-05T10:00:45Z"), ora)).toEqual({
      chiave: "Troppi tentativi: riprova fra {{n}} secondi",
      n: 45,
    });
    expect(attesa(new Date("2026-09-05T10:02:10Z"), ora)).toEqual({
      chiave: "Troppi tentativi: riprova fra {{n}} minuti",
      n: 3,
    });
  });
});

describe("all'accesso", () => {
  it("due errori non chiudono niente; al terzo l'account si chiude e gli admin lo sanno", async () => {
    expect((await login("lia@x.local", "sbagliata-0000")).statusCode).toBe(401);
    expect((await login("lia@x.local", "sbagliata-0000")).statusCode).toBe(401);
    // ancora aperto: la password giusta entra e azzera
    const ok = await login("lia@x.local", "giusta-1234");
    expect(ok.statusCode).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: utenteId } })).failedPasswordAttempts,
    ).toBe(0);

    for (let i = 0; i < 3; i += 1)
      expect((await login("lia@x.local", "sbagliata-0000")).statusCode).toBe(401);
    const chiuso = await login("lia@x.local", "giusta-1234");
    expect(chiuso.statusCode).toBe(423);
    expect(chiuso.json().message).toMatch(/(riprova fra|try again in) \d+ (secondi|seconds)/);
    const stato = await prisma.user.findUniqueOrThrow({ where: { id: utenteId } });
    expect(stato.failedPasswordAttempts).toBe(3);
    expect(stato.passwordLockedUntil!.getTime()).toBeGreaterThan(Date.now() + 25_000);

    await flushMail();
    expect(posta.sent.map((m) => m.to)).toEqual(["admin@x.local"]);
    expect(posta.sent[0]!.subject).toContain("Lia Locka");
    expect(posta.sent[0]!.text).toMatch(/3 (password sbagliate|wrong passwords)/);
    // un tentativo durante la chiusura non conta e non rimanda l'email
    expect((await login("lia@x.local", "sbagliata-0000")).statusCode).toBe(423);
    await flushMail();
    expect(posta.sent).toHaveLength(1);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: utenteId } })).failedPasswordAttempts,
    ).toBe(3);
  });

  it("scaduta la chiusura, un altro errore raddoppia l'attesa", async () => {
    await prisma.user.update({
      where: { id: utenteId },
      data: {
        failedPasswordAttempts: 3,
        passwordLockedUntil: new Date(Date.now() - 1000),
        lockoutAlertedAt: new Date(),
      },
    });
    expect((await login("lia@x.local", "sbagliata-0000")).statusCode).toBe(401);
    const stato = await prisma.user.findUniqueOrThrow({ where: { id: utenteId } });
    expect(stato.failedPasswordAttempts).toBe(4);
    expect(stato.passwordLockedUntil!.getTime()).toBeGreaterThan(Date.now() + 55_000);
    expect(stato.passwordLockedUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    await flushMail();
    expect(posta.sent).toHaveLength(0); // avvisati già in questo episodio
  });
});

describe("l'amministratore", () => {
  it("azzera il freno, e la persona rientra subito; la lista dice chi è chiuso", async () => {
    await prisma.user.update({
      where: { id: utenteId },
      data: { failedPasswordAttempts: 5, passwordLockedUntil: new Date(Date.now() + 600_000) },
    });
    const lista = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { cookie: adminCookie },
    });
    const lia = (
      lista.json() as Array<{
        id: string;
        lockedUntil: string | null;
        failedPasswordAttempts: number;
      }>
    ).find((u) => u.id === utenteId)!;
    expect(lia.failedPasswordAttempts).toBe(5);
    expect(lia.lockedUntil).not.toBeNull();

    expect((await login("lia@x.local", "giusta-1234")).statusCode).toBe(423);
    const sblocco = await app.inject({
      method: "POST",
      url: `/api/users/${utenteId}/unlock`,
      headers: { cookie: adminCookie },
    });
    expect(sblocco.statusCode).toBe(204);
    expect((await login("lia@x.local", "giusta-1234")).statusCode).toBe(200);
  });

  it("un membro non può azzerare nessuno", async () => {
    const accesso = await login("lia@x.local", "giusta-1234");
    const cookie = accesso.headers["set-cookie"]!.toString().split(";")[0]!;
    const r = await app.inject({
      method: "POST",
      url: `/api/users/${utenteId}/unlock`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("al cambio password", () => {
  it("la password attuale sbagliata conta come al login", async () => {
    const accesso = await login("lia@x.local", "giusta-1234");
    const cookie = accesso.headers["set-cookie"]!.toString().split(";")[0]!;
    const cambia = (currentPassword: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/change-password",
        headers: { cookie },
        payload: { currentPassword, newPassword: "nuova-password-1234" },
      });
    for (let i = 0; i < 3; i += 1) {
      const r = await cambia("sbagliata-0000");
      expect(r.statusCode, r.body).toBe(400);
    }
    const chiuso = await cambia("giusta-1234");
    expect(chiuso.statusCode, chiuso.body).toBe(423);
    expect((await login("lia@x.local", "giusta-1234")).statusCode).toBe(423);
  });
});
