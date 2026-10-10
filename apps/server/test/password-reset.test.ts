// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

/**
 * Reset della password da parte di un amministratore (15/08/2026).
 *
 * Tre cose devono valere insieme, e separate non servono a niente: la password
 * nuova è **provvisoria**, le sessioni si chiudono, e le credenziali **partono
 * per email** — l'unico canale verso chi in questo momento non entra. La quarta
 * è il guardrail: finché la password è quella provvisoria, la sessione apre
 * solo le rotte per cambiarla, e questo vale anche per chi chiama le API senza
 * passare dal browser.
 */

const { tempDir } = prepareTestDb("password-reset");
process.env.MAILER_HOST = "smtp.example";
process.env.APP_BASE_URL = "https://keelops.example";

const { prisma } = await import("../src/db");
const { setMailTransport } = await import("../src/modules/mail/service");
const { memoryTransport } = await import("../src/modules/mail/transports");
const { buildApp } = await import("../src/app");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

const posta = memoryTransport();
let app: Awaited<ReturnType<typeof buildApp>>;
let adminCookie = "";
let utenteId = "";

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  return cookie ? `${SESSION_COOKIE}=${cookie.value}` : "";
}

beforeAll(async () => {
  setMailTransport(posta);
  const hash = await hashPassword("prova-1234");
  const utente = await prisma.user.create({
    data: {
      email: "vera@x.local",
      name: "Vera Verdi",
      role: UserRole.MEMBER,
      passwordHash: hash,
      locale: "it",
    },
  });
  await prisma.user.create({
    data: {
      email: "admin@x.local",
      name: "Amministratore",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato
      passwordHash: hash,
      locale: "it",
    },
  });
  utenteId = utente.id;
  app = await buildApp();
  adminCookie = await loginCookie("admin@x.local", "prova-1234");
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
    data: { passwordHash: await hashPassword("prova-1234"), mustChangePassword: false },
  });
});

async function reimposta(password: string) {
  return app.inject({
    method: "POST",
    url: `/api/users/${utenteId}/reset-password`,
    headers: { cookie: adminCookie },
    payload: { password },
  });
}

describe("reset della password (amministratore)", () => {
  it("segna la password come provvisoria e chiude le sessioni dell'utente", async () => {
    const cookiePrima = await loginCookie("vera@x.local", "prova-1234");
    expect(cookiePrima).not.toBe("");

    const risposta = await reimposta("nuova-9876");
    expect(risposta.statusCode).toBe(200);

    const utente = await prisma.user.findUniqueOrThrow({ where: { id: utenteId } });
    expect(utente.mustChangePassword).toBe(true);
    // La vecchia sessione non vale più: la password è arrivata a qualcun altro.
    const conVecchiaSessione = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookiePrima },
    });
    expect(conVecchiaSessione.statusCode).toBe(401);
  });

  it("manda le credenziali per email e lo dice a chi ha premuto il pulsante", async () => {
    const risposta = await reimposta("nuova-9876");
    expect(risposta.json()).toEqual({ emailSent: true, email: "vera@x.local" });

    expect(posta.sent).toHaveLength(1);
    const messaggio = posta.sent[0]!;
    expect(messaggio.to).toBe("vera@x.local");
    // La password serve a niente senza sapere dove usarla: indirizzo pubblico
    // e password stanno nello stesso messaggio, in testo e in HTML.
    expect(messaggio.text).toContain("nuova-9876");
    expect(messaggio.text).toContain("https://keelops.example");
    expect(messaggio.html).toContain("nuova-9876");
    // E dice che è provvisoria: chi la riceve deve aspettarsi la richiesta.
    expect(messaggio.text).toContain("Al primo accesso");
  });

  it("se la posta non consegna, il reset vale lo stesso e la risposta lo dichiara", async () => {
    // Senza trasporto di prova si ricade su quello vero, che non raggiunge
    // `smtp.example`: è il caso reale della posta mal configurata, e non deve
    // far sembrare fallito un reset già avvenuto (l'admin lo ripeterebbe).
    setMailTransport(null);
    try {
      const risposta = await reimposta("nuova-9876");
      expect(risposta.statusCode).toBe(200);
      expect(risposta.json().emailSent).toBe(false);
      const utente = await prisma.user.findUniqueOrThrow({ where: { id: utenteId } });
      expect(utente.mustChangePassword).toBe(true);
    } finally {
      setMailTransport(posta);
    }
  });

  it("solo un amministratore reimposta la password di un altro", async () => {
    const suo = await loginCookie("vera@x.local", "prova-1234");
    const risposta = await app.inject({
      method: "POST",
      url: `/api/users/${utenteId}/reset-password`,
      headers: { cookie: suo },
      payload: { password: "nuova-9876" },
    });
    expect(risposta.statusCode).toBe(403);
  });
});

describe("password provvisoria: la sessione serve solo a cambiarla", () => {
  it("entra, ma l'applicazione resta chiusa finché non ne sceglie una sua", async () => {
    await reimposta("nuova-9876");
    const cookie = await loginCookie("vera@x.local", "nuova-9876");
    expect(cookie).not.toBe("");

    // Sapere chi si è: sempre concesso, ed è così che il browser scopre di
    // dover mostrare la schermata.
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().mustChangePassword).toBe(true);

    // Tutto il resto no — nemmeno chiamando le API a mano.
    const tasks = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie } });
    expect(tasks.statusCode).toBe(403);

    const cambio = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie },
      payload: { currentPassword: "nuova-9876", newPassword: "sceltamia-1" },
    });
    expect(cambio.statusCode).toBe(204);

    // Da qui in poi l'applicazione è aperta e il segno è sparito.
    const dopo = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(dopo.json().mustChangePassword).toBe(false);
    const tasksDopo = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie } });
    expect(tasksDopo.statusCode).toBe(200);
  });

  it("la vecchia password non entra più", async () => {
    await reimposta("nuova-9876");
    const risposta = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "vera@x.local", password: "prova-1234" },
    });
    expect(risposta.statusCode).toBe(401);
  });
});
