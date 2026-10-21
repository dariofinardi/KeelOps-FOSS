// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

prepareTestDb("deals-investors-filter");

/**
 * **Solo le offerte condivise con gli investitori** (21/10/2026): il filtro
 * dell'elenco Offerte, e il suo numero contato con gli altri filtri ma senza
 * il proprio, come ogni tendina.
 */
const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie = "";

beforeAll(async () => {
  app = await buildApp();
  const admin = await prisma.user.create({
    data: {
      email: "sudo@x.local",
      name: "sudo",
      role: "ADMIN",
      adminUntil: new Date("2099-01-01"),
    },
  });
  const token = randomBytes(24).toString("hex");
  await prisma.session.create({
    data: {
      id: createHash("sha256").update(token).digest("hex"),
      userId: admin.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  cookie = `kancrm_session_dev=${token}`;
  const fase = await prisma.dealStage.create({
    data: { name: "Trattativa", color: "#f59e0b", order: 0 },
  });
  // gli stati arrivano dalle migrazioni: quelli commerciali ci sono
  const stato = await prisma.taskStatus.findFirstOrThrow({ where: { category: "SALES" } });
  const acme = await prisma.company.create({ data: { name: "Acme" } });
  for (const [title, condivisa, companyId] of [
    ["Condivisa Acme", true, acme.id],
    ["Condivisa altrove", true, null],
    ["Riservata Acme", false, acme.id],
  ] as const) {
    await prisma.task.create({
      data: {
        kind: "DEAL",
        title,
        statusId: stato.id,
        creatorId: admin.id,
        dealStageId: fase.id,
        companyId,
        visibleToSalesMonitors: condivisa,
      },
    });
  }
});

afterAll(async () => {
  await app.close();
});

const elenco = async (query: string) => {
  const r = await app.inject({ method: "GET", url: `/api/deals?${query}`, headers: { cookie } });
  expect(r.statusCode).toBe(200);
  return r.json() as {
    items: Array<{ title: string }>;
    total: number;
    facets: { sharedWithInvestors: number };
  };
};

describe("il filtro «condivise con gli investitori»", () => {
  it("senza filtro tutte, e il numero delle condivise", async () => {
    const tutte = await elenco("");
    expect(tutte.total).toBe(3);
    expect(tutte.facets.sharedWithInvestors).toBe(2);
  });

  it("con il filtro solo le condivise; il numero non si conta su sé stesso", async () => {
    const solo = await elenco("investors=shared");
    expect(solo.items.map((d) => d.title).sort()).toEqual(["Condivisa Acme", "Condivisa altrove"]);
    expect(solo.facets.sharedWithInvestors).toBe(2);
  });

  it("si somma agli altri filtri, e il numero li segue", async () => {
    const acme = (await prisma.company.findFirstOrThrow({ where: { name: "Acme" } })).id;
    const r = await elenco(`investors=shared&companyId=${acme}`);
    expect(r.items.map((d) => d.title)).toEqual(["Condivisa Acme"]);
    const senza = await elenco(`companyId=${acme}`);
    expect(senza.total).toBe(2);
    expect(senza.facets.sharedWithInvestors).toBe(1);
  });

  it("un valore sconosciuto è un errore, non un filtro ignorato", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/deals?investors=boh",
      headers: { cookie },
    });
    expect(r.statusCode).toBe(400);
  });
});
