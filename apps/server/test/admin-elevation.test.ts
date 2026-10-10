// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("admin-elevation");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

/**
 * Privilegi di amministratore a richiesta (stile sudo): l'admin lavora da
 * utente normale e si eleva per mezz'ora quando serve. La prova che conta è
 * che il ruolo EFFICACE governi davvero l'applicazione — non solo il menù.
 */

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;
let memberCookie: string;
let adminId: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

const me = (cookie: string) => app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
const adminPage = (cookie: string) =>
  app.inject({ method: "GET", url: "/api/admin/system", headers: { cookie } });
const elevate = (cookie: string) =>
  app.inject({ method: "POST", url: "/api/auth/elevate", headers: { cookie } });

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      passwordHash: await hashPassword("admin1234"),
    },
  });
  adminId = admin.id;
  await prisma.user.create({
    data: {
      email: "member@test.local",
      name: "Member",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("member1234"),
    },
  });
  app = await buildApp();
  adminCookie = await loginCookie("admin@test.local", "admin1234");
  memberCookie = await loginCookie("member@test.local", "member1234");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("privilegi di amministratore a richiesta", () => {
  it("senza elevarsi, l'admin è un utente normale: niente pagine admin", async () => {
    const dto = (await me(adminCookie)).json();
    expect(dto.role).toBe(UserRole.MEMBER);
    // …ma sa di poterlo diventare, o il pulsante non comparirebbe.
    expect(dto.canElevate).toBe(true);
    expect(dto.adminUntil).toBeNull();
    expect((await adminPage(adminCookie)).statusCode).toBe(403);
  });

  it("elevandosi ottiene i privilegi, e lo dice nel DTO", async () => {
    const response = await elevate(adminCookie);
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe(UserRole.ADMIN);
    expect(response.json().adminUntil).not.toBeNull();
    expect((await adminPage(adminCookie)).statusCode).toBe(200);
    expect((await me(adminCookie)).json().role).toBe(UserRole.ADMIN);
  });

  it("l'elevazione scade da sé: passata la mezz'ora si torna normali", async () => {
    await prisma.user.update({
      where: { id: adminId },
      data: { adminUntil: new Date(Date.now() - 60_000) },
    });
    const dto = (await me(adminCookie)).json();
    expect(dto.role).toBe(UserRole.MEMBER);
    expect(dto.adminUntil).toBeNull();
    expect((await adminPage(adminCookie)).statusCode).toBe(403);
  });

  it("si può rientrare subito, senza aspettare la scadenza", async () => {
    await elevate(adminCookie);
    expect((await adminPage(adminCookie)).statusCode).toBe(200);
    const down = await app.inject({
      method: "POST",
      url: "/api/auth/step-down",
      headers: { cookie: adminCookie },
    });
    expect(down.statusCode).toBe(200);
    expect(down.json().role).toBe(UserRole.MEMBER);
    expect((await adminPage(adminCookie)).statusCode).toBe(403);
  });

  /**
   * Le pagine che l'admin apre DA elevato, tutte allo stesso modo: senza
   * elevazione rispondono 403 e con l'elevazione lavorano. Il 26/08/2026 in
   * produzione è successo il giro completo — elevazione, rientro da un'altra
   * finestra, e poi utenti/visibilità/stati che rifiutavano mentre la pagina
   * continuava a offrirli.
   */
  const rotteDaElevato = [
    { nome: "elenco utenti", metodo: "GET" as const, url: "/api/users" },
    { nome: "aree di visibilità", metodo: "GET" as const, url: "/api/visibility-settings" },
    { nome: "sistema", metodo: "GET" as const, url: "/api/admin/system" },
    { nome: "cestino", metodo: "GET" as const, url: "/api/trash" },
  ];

  it("le pagine da amministratore rifiutano tutte, senza elevazione", async () => {
    await prisma.user.update({ where: { id: adminId }, data: { adminUntil: null } });
    for (const rotta of rotteDaElevato) {
      const risposta = await app.inject({
        method: rotta.metodo,
        url: rotta.url,
        headers: { cookie: adminCookie },
      });
      expect({ [rotta.nome]: risposta.statusCode }).toEqual({ [rotta.nome]: 403 });
    }
  });

  it("…e con l'elevazione lavorano tutte", async () => {
    await elevate(adminCookie);
    for (const rotta of rotteDaElevato) {
      const risposta = await app.inject({
        method: rotta.metodo,
        url: rotta.url,
        headers: { cookie: adminCookie },
      });
      expect({ [rotta.nome]: risposta.statusCode }).toEqual({ [rotta.nome]: 200 });
    }
  });

  it("gli stati si aggiungono solo da elevato, e il rifiuto lo dice", async () => {
    await prisma.user.update({ where: { id: adminId }, data: { adminUntil: null } });
    const nuovo = {
      name: "Pronto per DEV",
      category: "DEV",
      color: "#ff00ff",
      isClosed: false,
      isWonTarget: false,
      isAssignedTarget: false,
      stopsRecurrence: false,
      isBillingMilestone: false,
      wipLimit: null,
    };
    const rifiutato = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie: adminCookie },
      payload: nuovo,
    });
    expect(rifiutato.statusCode).toBe(403);
    // il messaggio è quello che l'interfaccia mostra: dice PERCHÉ
    expect(rifiutato.json().message).toMatch(/amministratori|manager/i);

    await elevate(adminCookie);
    const creato = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie: adminCookie },
      payload: nuovo,
    });
    expect(creato.statusCode).toBe(201);
    expect(creato.json().name).toBe("Pronto per DEV");
  });

  it("chi admin non è non può elevarsi: la porta non si apre da sola", async () => {
    const response = await elevate(memberCookie);
    expect(response.statusCode).toBe(403);
    expect((await me(memberCookie)).json().canElevate).toBe(false);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { email: "member@test.local" } });
    expect(fresh.adminUntil).toBeNull();
  });

  it("la maschera vale anche per la VISIBILITÀ, non solo per le pagine admin", async () => {
    // L'admin non elevato non è in nessun gruppo: senza scope non vede le
    // offerte, come un collega qualunque. Elevato, torna a vedere tutto.
    await prisma.user.update({ where: { id: adminId }, data: { adminUntil: null } });
    expect((await me(adminCookie)).json().canSeeDeals).toBe(false);
    await elevate(adminCookie);
    expect((await me(adminCookie)).json().canSeeDeals).toBe(true);
  });
});
