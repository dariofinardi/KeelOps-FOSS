// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("admin-cli");

const { prisma } = await import("../src/db");
const { DEFAULT_RESET_PASSWORD, createAdmin, listUsers, provisionalPassword, resetUserPassword } =
  await import("../src/modules/users/admin-cli");
const { checkPassword } = await import("../src/modules/auth/password");
const { createSession } = await import("../src/modules/auth/session");

let attivoId = "";

beforeAll(async () => {
  const vecchio = new Date("2026-01-15T09:00:00.000Z");
  const attivo = await prisma.user.create({
    data: {
      email: "attivo@x.local",
      name: "Anna Attiva",
      role: UserRole.MEMBER,
      lastLoginAt: new Date("2026-08-01T08:00:00.000Z"),
    },
  });
  attivoId = attivo.id;
  await prisma.user.create({
    data: {
      email: "fermo@x.local",
      name: "Franco Fermo",
      role: UserRole.MEMBER,
      lastLoginAt: vecchio,
    },
  });
  await prisma.user.create({
    data: { email: "mai@x.local", name: "Mario Mai", role: UserRole.MEMBER },
  });
  await prisma.user.create({
    data: { email: "archivio@x.local", name: "Archivio", role: UserRole.MEMBER, isSystem: true },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("elenco utenti da riga di comando", () => {
  it("ordina dal più recente, e chi non è mai entrato resta in fondo", async () => {
    // È l'ordine utile a chi cerca account fermi o mai usati.
    const righe = await listUsers();
    expect(righe.map((r) => r.email)).toEqual(["attivo@x.local", "fermo@x.local", "mai@x.local"]);
    expect(righe[2]!.lastLoginAt).toBeNull();
  });

  it("accesso e attività sono due date distinte", async () => {
    // La sessione dura giorni: chi ha fatto l'accesso lunedì e sta lavorando
    // adesso deve risultare attivo oggi, non fermo a lunedì.
    await prisma.user.update({
      where: { id: attivoId },
      data: { lastSeenAt: new Date("2026-08-05T07:30:00.000Z") },
    });
    const riga = (await listUsers()).find((r) => r.email === "attivo@x.local")!;
    expect(riga.lastLoginAt?.toISOString()).toBe("2026-08-01T08:00:00.000Z");
    expect(riga.lastSeenAt?.toISOString()).toBe("2026-08-05T07:30:00.000Z");
  });

  it("l'utente di sistema non compare: non ha un accesso", async () => {
    expect((await listUsers()).some((r) => r.email === "archivio@x.local")).toBe(false);
  });
});

describe("reset della password da riga di comando", () => {
  it("scrive un hash valido e chiude le sessioni aperte", async () => {
    // Due sessioni aperte: il reset serve proprio quando qualcun altro potrebbe
    // essere dentro con le credenziali vecchie.
    await createSession(attivoId);
    await createSession(attivoId);
    expect(await prisma.session.count({ where: { userId: attivoId } })).toBe(2);

    const esito = await resetUserPassword("attivo@x.local");
    expect(esito.password).toBe(DEFAULT_RESET_PASSWORD);
    expect(esito.closedSessions).toBe(2);
    expect(await prisma.session.count({ where: { userId: attivoId } })).toBe(0);

    // L'hash è quello dell'applicazione: la nuova password entra davvero.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: attivoId } });
    expect((await checkPassword(user.passwordHash!, DEFAULT_RESET_PASSWORD)).ok).toBe(true);
    expect((await checkPassword(user.passwordHash!, "altra-password")).ok).toBe(false);
    // Come dalla pagina Utenti: è una password scelta da qualcun altro, quindi
    // vale un accesso e poi la persona ne sceglie una sua.
    expect(user.mustChangePassword).toBe(true);
  });

  it("accetta una password diversa se la si indica", async () => {
    await resetUserPassword("fermo@x.local", "Password-scelta-1");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "fermo@x.local" } });
    expect((await checkPassword(user.passwordHash!, "Password-scelta-1")).ok).toBe(true);
  });

  it("l'indirizzo si può scrivere come capita", async () => {
    // Chi lo copia da una email se lo ritrova con le maiuscole o con spazi.
    const esito = await resetUserPassword("  Mai@X.local  ");
    expect(esito.email).toBe("mai@x.local");
  });

  it("un indirizzo che non esiste lo dice, invece di non fare niente in silenzio", async () => {
    await expect(resetUserPassword("nessuno@x.local")).rejects.toThrow(/Nessun utente/);
  });

  it("l'utente di sistema non si tocca", async () => {
    await expect(resetUserPassword("archivio@x.local")).rejects.toThrow(/sistema/);
  });
});

describe("il primo amministratore di un'istanza nuova", () => {
  it("nasce amministratore, con una password provvisoria che entra e va cambiata", async () => {
    const esito = await createAdmin("Studio@Rossi.it ", "Avv. Rossi");
    expect(esito.email).toBe("studio@rossi.it");
    const utente = await prisma.user.findUniqueOrThrow({ where: { email: "studio@rossi.it" } });
    expect(utente.role).toBe(UserRole.ADMIN);
    expect(utente.mustChangePassword).toBe(true);
    expect((await checkPassword(utente.passwordHash!, esito.password)).ok).toBe(true);
  });

  it("se esiste già non tocca niente: per la password c'è reset", async () => {
    await expect(createAdmin("studio@rossi.it", "Altro")).rejects.toThrow(/reset/);
    await expect(createAdmin("non-una-email", "X")).rejects.toThrow(/indirizzo/);
  });

  it("la password provvisoria si legge a voce: tre gruppi, niente caratteri ambigui", () => {
    const password = provisionalPassword();
    expect(password).toMatch(/^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/);
    expect(password).not.toMatch(/[01oOlI]/);
    expect(provisionalPassword()).not.toBe(password);
  });
});
