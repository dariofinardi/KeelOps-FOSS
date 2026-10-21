// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

prepareTestDb("funzioni-istanza");

/**
 * **Le funzioni dell'istanza** (17/10/2026): spegnere un'area del nucleo la
 * toglie davvero — rotte, scope dei gruppi, DTO, creazione di task — e
 * riaccenderla la rimette senza riavvio. Vedi `plan/funzioni-istanza.md`.
 */
const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { caricaFunzioni, cronCondizionato } = await import("../src/edition/funzioni");
const { funzioneAttiva } = await import("../src/edition/funzioni-stato");

let app: Awaited<ReturnType<typeof buildApp>>;
const sessions: Record<string, string> = {};

async function mkUser(key: string, role: string, adminUntil: Date | null = null) {
  const user = await prisma.user.create({
    data: { email: `${key}@test.local`, name: `Utente ${key}`, role, isActive: true, adminUntil },
  });
  const token = randomBytes(24).toString("hex");
  await prisma.session.create({
    data: {
      id: createHash("sha256").update(token).digest("hex"),
      userId: user.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  sessions[key] = token;
  return user;
}

const call = (url: string, key: string, method: "GET" | "PUT" | "POST" = "GET", body?: unknown) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: `kancrm_session_dev=${sessions[key]}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body ? JSON.stringify(body) : undefined,
  });

const spegni = (spente: string[]) => call("/api/admin/funzioni", "sudo", "PUT", { spente });

beforeAll(async () => {
  app = await buildApp();
  await mkUser("sudo", "ADMIN", new Date(Date.now() + 30 * 60_000)); // elevato
  await mkUser("admin", "ADMIN"); // non elevato
  const venditore = await mkUser("venditore", "MEMBER");
  const gruppo = await prisma.group.create({ data: { name: "Commerciali" } });
  await prisma.groupMember.create({ data: { groupId: gruppo.id, userId: venditore.id } });
  await prisma.visibilitySetting.create({
    data: { groupId: gruppo.id, scope: "DEALS", access: "FULL" },
  });
});

beforeEach(async () => {
  await prisma.appSetting.deleteMany({ where: { key: "istanza.funzioniSpente" } });
  await caricaFunzioni();
});

afterAll(async () => {
  await app.close();
});

describe("chi le cambia", () => {
  it("leggerle e cambiarle è da amministratore elevato", async () => {
    expect((await call("/api/admin/funzioni", "venditore")).statusCode).toBe(403);
    expect((await call("/api/admin/funzioni", "admin")).statusCode).toBe(403);
    expect(
      (await call("/api/admin/funzioni", "admin", "PUT", { spente: ["offerte"] })).statusCode,
    ).toBe(403);
    expect(funzioneAttiva("offerte")).toBe(true);
    const stato = await call("/api/admin/funzioni", "sudo");
    expect(stato.statusCode).toBe(200);
    expect(stato.json().map((f: { chiave: string }) => f.chiave)).toContain("offerte");
  });

  it("una chiave sconosciuta si rifiuta, con il nome", async () => {
    const risposta = await spegni(["scadenzario"]);
    expect(risposta.statusCode).toBe(400);
    expect(risposta.body).toContain("scadenzario");
  });
});

describe("un'area del nucleo spenta", () => {
  it("di partenza tutto è acceso, e il DTO non elenca niente", async () => {
    const me = (await call("/api/auth/me", "venditore")).json();
    expect(me.funzioniSpente).toEqual([]);
    expect(me.canSeeDeals).toBe(true);
    expect((await call("/api/deals", "venditore")).statusCode).toBe(200);
  });

  it("spegnere le offerte: rotte 404, scope tolto anche all'amministratore, DTO aggiornato", async () => {
    const risposta = await spegni(["offerte"]);
    expect(risposta.statusCode).toBe(200);
    const offerte = risposta.json().find((f: { chiave: string }) => f.chiave === "offerte");
    expect(offerte.spenta).toBe(true);

    expect((await call("/api/deals", "venditore")).statusCode).toBe(404);
    expect((await call("/api/deal-stages", "sudo")).statusCode).toBe(404);
    const me = (await call("/api/auth/me", "venditore")).json();
    expect(me.funzioniSpente).toContain("offerte");
    expect(me.canSeeDeals).toBe(false);
    expect((await call("/api/auth/me", "sudo")).json().canSeeDeals).toBe(false);
    // le altre aree restano
    expect((await call("/api/tasks", "venditore")).statusCode).toBe(200);
  });

  it("riaccenderla la rimette senza riavvio", async () => {
    await spegni(["offerte"]);
    expect((await call("/api/deals", "venditore")).statusCode).toBe(404);
    await spegni([]);
    expect((await call("/api/deals", "venditore")).statusCode).toBe(200);
    expect((await call("/api/auth/me", "venditore")).json().canSeeDeals).toBe(true);
  });

  it("con i progetti spenti non nasce un task di progetto", async () => {
    const progetto = await prisma.project.create({ data: { name: "Interno" } });
    await spegni(["progetti"]);
    expect((await call("/api/projects", "sudo")).statusCode).toBe(404);
    const risposta = await call("/api/tasks", "sudo", "POST", {
      title: "Dentro un progetto spento",
      projectId: progetto.id,
    });
    expect(risposta.statusCode).toBe(400);
    expect(await prisma.task.count({ where: { projectId: progetto.id } })).toBe(0);
  });

  it("l'andamento spento non si offre a nessuno", async () => {
    await spegni(["andamento"]);
    expect((await call("/api/auth/me", "sudo")).json().canSeeDevMetrics).toBe(false);
    expect((await call("/api/dashboard/dev-metrics", "sudo")).statusCode).toBe(404);
  });

  it("uno stato scritto da fuori si legge alla rilettura; un JSON rotto vale tutto acceso", async () => {
    await prisma.appSetting.upsert({
      where: { key: "istanza.funzioniSpente" },
      create: { key: "istanza.funzioniSpente", value: '["contatti"]' },
      update: { value: '["contatti"]' },
    });
    await caricaFunzioni();
    expect(funzioneAttiva("contatti")).toBe(false);
    await prisma.appSetting.update({
      where: { key: "istanza.funzioniSpente" },
      data: { value: "{rotto" },
    });
    await caricaFunzioni();
    expect(funzioneAttiva("contatti")).toBe(true);
  });
});

describe("il cron di un modulo spegnibile", () => {
  it("il lavoro parte solo se il modulo è acceso, e la pianificazione resta", () => {
    const pianificati: Array<(contesto: never) => unknown> = [];
    const base = {
      schedule: (_quando: string, lavoro: (contesto: never) => unknown) => {
        pianificati.push(lavoro);
        return {} as never;
      },
    } as never;
    let acceso = false;
    let eseguito = 0;
    cronCondizionato(base, () => acceso).schedule("0 3 * * *", () => {
      eseguito += 1;
    });
    expect(pianificati).toHaveLength(1);
    pianificati[0]!({} as never);
    expect(eseguito).toBe(0);
    acceso = true;
    pianificati[0]!({} as never);
    expect(eseguito).toBe(1);
  });
});
