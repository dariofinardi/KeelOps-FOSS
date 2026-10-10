// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskKind, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

/**
 * **La cronologia di un'offerta** (01/10/2026): i numeri della previsione —
 * probabilità e chiusura prevista — lasciano traccia a ogni cambio, come gli
 * allegati caricati. E un'offerta vinta va al 100%: la previsione la contava
 * già per intero, ma il campo continuava a dire la stima di prima.
 */
const { tempDir } = prepareTestDb("deal-history");
const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
const PW = "password-di-prova-1";
const ids: Record<string, string> = {};
let sessione = "";

const patch = (id: string, payload: object) =>
  app.inject({
    method: "PATCH",
    url: `/api/deals/${id}`,
    headers: { cookie: sessione },
    payload,
  });
const voci = async (taskId: string, action: string) =>
  (
    await prisma.activityLog.findMany({ where: { taskId, action }, orderBy: { createdAt: "asc" } })
  ).map((v) => JSON.parse(v.payload ?? "null") as Record<string, unknown>);

beforeAll(async () => {
  const utente = await prisma.user.create({
    data: {
      email: "super@x.local",
      name: "super",
      role: UserRole.ADMIN,
      passwordHash: await hashPassword(PW),
      adminUntil: new Date("2099-01-01"),
    },
  });
  ids.utente = utente.id;
  const stato = await prisma.taskStatus.findFirstOrThrow({ where: { category: "SALES" } });
  ids.aperta = (
    await prisma.dealStage.create({ data: { name: "Trattativa", color: "#000", order: 0 } })
  ).id;
  ids.vinta = (
    await prisma.dealStage.create({ data: { name: "Vinta", color: "#000", order: 1, isWon: true } })
  ).id;
  ids.offerta = (
    await prisma.task.create({
      data: {
        kind: TaskKind.DEAL,
        title: "Fornitura scaffali",
        statusId: stato.id,
        dealStageId: ids.aperta,
        creatorId: utente.id,
        assigneeId: utente.id,
        dealValue: 12000,
        probability: 30,
        expectedCloseDate: new Date("2026-10-31T00:00:00.000Z"),
      },
    })
  ).id;
  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "super@x.local", password: PW },
  });
  sessione = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("la cronologia di un'offerta", () => {
  it("un cambio di probabilità resta, da quanto a quanto", async () => {
    expect((await patch(ids.offerta!, { probability: 60 })).statusCode).toBe(200);
    expect(await voci(ids.offerta!, "probability_changed")).toEqual([{ from: 30, to: 60 }]);
    // salvare lo stesso numero non è un cambio
    await patch(ids.offerta!, { probability: 60 });
    expect(await voci(ids.offerta!, "probability_changed")).toHaveLength(1);
  });

  it("anche la chiusura prevista", async () => {
    expect((await patch(ids.offerta!, { expectedCloseDate: "2026-12-15" })).statusCode).toBe(200);
    expect(await voci(ids.offerta!, "due_changed")).toEqual([
      { from: "2026-10-31", to: "2026-12-15" },
    ]);
  });

  it("e un allegato caricato", async () => {
    const boundary = "----kancrmdeal";
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${ids.offerta}/attachments/file`,
      headers: {
        cookie: sessione,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="preventivo.pdf"\r\n` +
          `Content-Type: application/pdf\r\n\r\n%PDF-1.4 prova\r\n--${boundary}--\r\n`,
      ),
    });
    expect(res.statusCode).toBe(201);
    expect(await voci(ids.offerta!, "attachment_added")).toEqual([
      { name: "preventivo.pdf", type: "FILE" },
    ]);
  });

  it("vinta, va al 100% e lo dice", async () => {
    expect((await patch(ids.offerta!, { stageId: ids.vinta })).statusCode).toBe(200);
    const offerta = await prisma.task.findUniqueOrThrow({ where: { id: ids.offerta } });
    expect(offerta.probability).toBe(100);
    expect((await voci(ids.offerta!, "probability_changed")).at(-1)).toEqual({ from: 60, to: 100 });
  });

  it("anche un'offerta registrata già vinta nasce al 100%", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: sessione },
      payload: { title: "Chiusa a cose fatte", stageId: ids.vinta, probability: 40 },
    });
    expect(res.statusCode).toBe(201);
    const offerta = await prisma.task.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(offerta.probability).toBe(100);
  });
});

describe("l'elenco ordinato per chiusura", () => {
  it("ordina sulla data che la colonna mostra: l'effettiva per le concluse", async () => {
    const base = await prisma.task.findUniqueOrThrow({ where: { id: ids.offerta } });
    const crea = (title: string, extra: object) =>
      prisma.task.create({
        data: {
          kind: TaskKind.DEAL,
          title,
          statusId: base.statusId,
          creatorId: ids.utente!,
          assigneeId: ids.utente!,
          ...extra,
        },
      });
    // prevista a maggio ma vinta il 22 agosto: va dopo l'aperta di giugno
    await crea("Vinta ad agosto", {
      dealStageId: ids.vinta,
      expectedCloseDate: new Date("2026-05-01T00:00:00.000Z"),
      closedAt: new Date("2026-08-22T12:00:00.000Z"),
    });
    await crea("Aperta a giugno", {
      dealStageId: ids.aperta,
      expectedCloseDate: new Date("2026-06-18T00:00:00.000Z"),
    });
    const elenco = async (sortDir: "asc" | "desc") =>
      (
        (
          await app.inject({
            method: "GET",
            url: `/api/deals?includeClosed=true&sortBy=expectedCloseDate&sortDir=${sortDir}`,
            headers: { cookie: sessione },
          })
        ).json().items as Array<{ title: string }>
      )
        .map((d) => d.title)
        .filter((t) => t === "Vinta ad agosto" || t === "Aperta a giugno");
    expect(await elenco("asc")).toEqual(["Aperta a giugno", "Vinta ad agosto"]);
    expect(await elenco("desc")).toEqual(["Vinta ad agosto", "Aperta a giugno"]);
  });
});

describe("il filtro per mese di chiusura", () => {
  it("conta la chiusura effettiva, poi la prevista; «senza-data» le offerte senza nessuna", async () => {
    const base = await prisma.task.findUniqueOrThrow({ where: { id: ids.offerta } });
    const crea = (title: string, extra: object) =>
      prisma.task.create({
        data: {
          kind: TaskKind.DEAL,
          title,
          statusId: base.statusId,
          creatorId: ids.utente!,
          assigneeId: ids.utente!,
          dealStageId: ids.aperta,
          ...extra,
        },
      });
    await crea("Mese: prevista a marzo", { expectedCloseDate: new Date("2027-03-15T00:00:00Z") });
    await crea("Mese: vinta a marzo", {
      dealStageId: ids.vinta,
      expectedCloseDate: new Date("2027-01-10T00:00:00Z"),
      closedAt: new Date("2027-03-31T12:00:00Z"),
    });
    await crea("Mese: prevista ad aprile", { expectedCloseDate: new Date("2027-04-01T00:00:00Z") });
    await crea("Mese: senza data", {});
    const titoli = async (months: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/deals?includeClosed=true&months=${months}`,
        headers: { cookie: sessione },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{ title: string }>;
        facets: { months: Array<{ key: string; count: number }> };
      };
      return {
        titoli: body.items
          .map((d) => d.title)
          .filter((t) => t.startsWith("Mese:"))
          .sort(),
        facet: body.facets.months,
      };
    };
    const marzo = await titoli("2027-03");
    expect(marzo.titoli).toEqual(["Mese: prevista a marzo", "Mese: vinta a marzo"]);
    expect((await titoli("2027-03,senza-data")).titoli).toEqual([
      "Mese: prevista a marzo",
      "Mese: senza data",
      "Mese: vinta a marzo",
    ]);
    // il facet si conta senza il proprio filtro, e «senza-data» sta in fondo
    expect(marzo.facet.find((m) => m.key === "2027-04")?.count).toBe(1);
    expect(marzo.facet.at(-1)?.key).toBe("senza-data");
  });
});
