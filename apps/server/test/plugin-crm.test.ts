// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

/**
 * **Offerte, rubrica e task prestati ai plugin per scrivere** (21/10/2026):
 * le regole sono quelle delle pagine, l'utente è quello efficace, e la
 * cronologia dice chi **e da dove** — «Dario via MCP».
 */
const { tempDir } = prepareTestDb("plugin-crm");
const { prisma } = await import("../src/db");
const { portaOfferte, portaCrm, aggiornaTaskPerPlugin } = await import("../src/plugins/plugin-crm");
const { creaTaskPerPlugin } = await import("../src/plugins/plugin-tasks");
const { conCanale } = await import("../src/lib/canale");
const { toActivityDto, activityInclude } = await import("../src/modules/tasks/serializers");

const offerte = portaOfferte("MCP");
const crm = portaCrm("MCP");
const aggiornaTask = aggiornaTaskPerPlugin("MCP");
const ids: Record<string, string> = {};

const cronologia = async (taskId: string) =>
  (
    await prisma.activityLog.findMany({
      where: { taskId },
      include: activityInclude,
      orderBy: { createdAt: "asc" },
    })
  ).map(toActivityDto);

beforeAll(async () => {
  const commerciali = await prisma.group.create({ data: { name: "Commerciali" } });
  const amministrativi = await prisma.group.create({ data: { name: "Amministrativi" } });
  await prisma.visibilitySetting.createMany({
    data: [
      { scope: "DEALS", groupId: commerciali.id, access: "FULL" },
      { scope: "CONTACTS", groupId: commerciali.id, access: "FULL" },
      { scope: "DEALS", groupId: amministrativi.id, access: "READ" },
    ],
  });
  for (const [k, role, adminUntil] of [
    ["dario", UserRole.MEMBER, null],
    ["lettore", UserRole.MEMBER, null],
    ["capo", UserRole.ADMIN, null], // amministratore non elevato: lavora da utente
    ["sudo", UserRole.ADMIN, new Date("2099-01-01")],
  ] as const) {
    ids[k] = (
      await prisma.user.create({ data: { email: `${k}@x.local`, name: k, role, adminUntil } })
    ).id;
  }
  await prisma.groupMember.create({ data: { groupId: commerciali.id, userId: ids.dario! } });
  await prisma.groupMember.create({ data: { groupId: amministrativi.id, userId: ids.lettore! } });
  ids.trattativa = (
    await prisma.dealStage.create({ data: { name: "Trattativa", color: "#f59e0b", order: 0 } })
  ).id;
  ids.vinta = (
    await prisma.dealStage.create({
      data: { name: "Vinta", color: "#22c55e", order: 1, isWon: true },
    })
  ).id;
  ids.acme = (await prisma.company.create({ data: { name: "Acme" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("le offerte", () => {
  it("si creano con le regole della pagina, e la cronologia dice «via MCP»", async () => {
    const offerta = await offerte.crea(ids.dario!, {
      title: "Rinnovo piattaforma 2027",
      companyId: ids.acme,
      dealValue: 12000,
      probability: 40,
      expectedCloseDate: "2026-12-15",
      assigneeId: ids.dario,
    });
    ids.offerta = offerta.id;
    const riga = await prisma.task.findUniqueOrThrow({ where: { id: offerta.id } });
    expect(riga).toMatchObject({ kind: "DEAL", creatorId: ids.dario, dealStageId: ids.trattativa });
    expect(riga.statusId).not.toBeNull();
    const voci = await cronologia(offerta.id);
    expect(voci).toHaveLength(1);
    expect(voci[0]).toMatchObject({ action: "created", via: "MCP", payload: null });
    expect(voci[0]!.user.id).toBe(ids.dario);
  });

  it("si modificano campo per campo: referente, visibilità ai finanziatori, fase", async () => {
    const contatto = await crm.creaContatto(ids.dario!, {
      firstName: "Giulia",
      lastName: "Neri",
      email: "giulia@acme.example",
      companyId: ids.acme,
    });
    await offerte.aggiorna(ids.dario!, ids.offerta!, {
      contactId: contatto.id,
      visibleToSalesMonitors: true,
      stageId: ids.vinta,
      dealValue: 15000,
    });
    const riga = await prisma.task.findUniqueOrThrow({ where: { id: ids.offerta! } });
    // una vinta è chiusa oggi e vale il 100%: la regola della pagina
    expect(riga).toMatchObject({
      contactId: contatto.id,
      visibleToSalesMonitors: true,
      probability: 100,
    });
    expect(riga.closedAt).not.toBeNull();
    const voci = await cronologia(ids.offerta!);
    const azioni = voci.map((v) => v.action);
    expect(azioni).toEqual(
      expect.arrayContaining([
        "contact_changed",
        "sales_monitor_visibility_changed",
        "stage_changed",
        "value_changed",
        "probability_changed",
      ]),
    );
    expect(voci.every((v) => v.via === "MCP" && v.user.id === ids.dario)).toBe(true);
    const referente = voci.find((v) => v.action === "contact_changed")!;
    expect(referente.payload).toEqual({ from: null, to: "Giulia Neri" });
  });

  it("valgono i permessi della persona: sola lettura e admin non elevato non creano", async () => {
    await expect(offerte.crea(ids.lettore!, { title: "No" })).rejects.toThrow(/sola lettura/);
    await expect(offerte.crea(ids.capo!, { title: "No" })).rejects.toThrow(/sola lettura/);
    const ok = await offerte.crea(ids.sudo!, { title: "Sì, da elevato" });
    expect(ok.id).toBeTruthy();
  });

  it("un dato incoerente si rifiuta con la sua frase", async () => {
    await expect(offerte.crea(ids.dario!, { title: "X", stageId: "non-esiste" })).rejects.toThrow(
      /Fase non valida/,
    );
    await expect(offerte.crea(ids.dario!, { title: "" })).rejects.toThrow();
  });
});

describe("la rubrica", () => {
  it("l'azienda si trova invece di raddoppiarla, o si crea", async () => {
    const stessa = await crm.azienda(ids.dario!, { name: "Acme srl" });
    expect(stessa).toEqual({ id: ids.acme, name: "Acme", created: false });
    const nuova = await crm.azienda(ids.dario!, { name: "Beta Spa", city: "Torino" });
    expect(nuova.created).toBe(true);
  });

  it("un contatto si lega solo a un'azienda che c'è, e si modifica", async () => {
    await expect(
      crm.creaContatto(ids.dario!, { firstName: "A", lastName: "B", companyId: "fantasma" }),
    ).rejects.toThrow(/Azienda non valida/);
    const c = await crm.creaContatto(ids.dario!, { firstName: "Luca", lastName: "Bianchi" });
    await crm.aggiornaContatto(ids.dario!, c.id, { roleTitle: "CTO", companyId: ids.acme });
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
      roleTitle: "CTO",
      companyId: ids.acme,
    });
  });

  it("senza le persone visibili non si crea un contatto", async () => {
    await expect(
      crm.creaContatto(ids.lettore!, { firstName: "A", lastName: "B" }),
    ).rejects.toThrow();
  });
});

describe("i task collegati all'offerta", () => {
  it("nascono collegati e si modificano, sempre «via MCP»; l'offerta no", async () => {
    const task = await conCanale("MCP", () =>
      creaTaskPerPlugin("mcppro", ids.dario!, {
        title: "Richiamare Giulia per il preventivo",
        relatedDealId: ids.offerta,
        dueDate: "2026-11-02",
      }),
    );
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).relatedDealId).toBe(
      ids.offerta,
    );
    await aggiornaTask(ids.dario!, task.id, { dueDate: "2026-11-05" });
    const voci = await cronologia(task.id);
    expect(voci.map((v) => v.action)).toEqual(expect.arrayContaining(["created", "due_changed"]));
    expect(voci.every((v) => v.via === "MCP")).toBe(true);
    await expect(aggiornaTask(ids.dario!, ids.offerta!, { title: "x" })).rejects.toThrow(
      /offerta si modifica/,
    );
  });

  it("fuori dal canale la cronologia non dice niente di più", async () => {
    const task = await creaTaskPerPlugin(null, ids.dario!, { title: "Dall'applicazione" });
    const [voce] = await cronologia(task.id);
    expect(voce!.via).toBeNull();
  });
});
