// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

prepareTestDb("login-rate-limit");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");

/**
 * **Il limite sui tentativi non deve punire i colleghi di chi ha sbagliato.**
 *
 * Contava per indirizzo IP, e su una rete aziendale l'IP è uno solo: due
 * password sbagliate su un account e tutto l'ufficio restava fuori per un
 * quarto d'ora (03/09/2026). Ora la chiave è IP + indirizzo di chi tenta.
 */
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

beforeAll(async () => {
  app = await buildApp();
  const passwordHash = await hashPassword("password-giusta");
  for (const email of [
    "uno@test.local",
    "due@test.local",
    "terzo@test.local",
    "quarto@test.local",
  ]) {
    await prisma.user.create({
      data: { email, name: email, role: UserRole.MEMBER, passwordHash },
    });
  }
});

const prova = (
  email: string,
  password: string,
  lingua?: string,
): Promise<Awaited<ReturnType<App["inject"]>>> =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    // Il browser manda la lingua a ogni richiesta (vedi web `lib/api.ts`): il
    // messaggio di rifiuto la deve rispettare, anche prima dell'accesso.
    ...(lingua ? { headers: { "x-locale": lingua } } : {}),
    payload: { email, password },
  });

describe("troppi tentativi di accesso", () => {
  it("chi sbaglia su un account non chiude fuori chi entra su un altro", async () => {
    // Il limite predefinito è 10 nella finestra: qui lo si supera abbondantemente.
    let bloccato = false;
    for (let i = 0; i < 14; i += 1) {
      const res = await prova("uno@test.local", "sbagliata");
      if (res.statusCode === 429) bloccato = true;
    }
    expect(bloccato, "il limite non è mai scattato: non protegge più").toBe(true);

    // Stesso IP, altro account: deve entrare.
    const altro = await prova("due@test.local", "password-giusta");
    expect(altro.statusCode, "un collega è stato chiuso fuori per colpa d'altri").toBe(200);
  });

  it("e quando scatta lo dice in italiano, non «riprova tra 11 minutes»", async () => {
    for (let i = 0; i < 14; i += 1) await prova("terzo@test.local", "sbagliata", "it");
    const bloccato = await prova("terzo@test.local", "sbagliata", "it");
    expect(bloccato.statusCode).toBe(429);
    const messaggio = (bloccato.json() as { message: string }).message;
    expect(messaggio).toContain("Troppi tentativi");
    expect(messaggio).toMatch(/minut[oi]/);
    expect(messaggio).not.toContain("minutes");

    // e in inglese esce tutto in inglese, non mezzo e mezzo
    for (let i = 0; i < 12; i += 1) await prova("quarto@test.local", "sbagliata", "en");
    const inglese = await prova("quarto@test.local", "sbagliata", "en");
    expect((inglese.json() as { message: string }).message).toContain("Too many attempts");
  });
});
