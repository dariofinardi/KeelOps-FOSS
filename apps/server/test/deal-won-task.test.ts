// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

prepareTestDb("deal-won-task");

const { prisma } = await import("../src/db");
const { buildApp } = await import("../src/app");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const { ensureWonDealTask } = await import("../src/modules/deals/won-task");

/**
 * **L'offerta vinta lascia una traccia in amministrazione.**
 *
 * Dal 21/08/2026 il task non nasceva più da sé: lo proponeva un pannello da
 * confermare. Il 04/09/2026, sui dati veri, quel pannello non era stato
 * confermato **nemmeno una volta** — sei proposte su sei — e un'offerta vinta
 * di due settimane prima non aveva ancora un task di fatturazione. Ora quando
 * la lettura non trova attività tecniche, cioè quando non c'è niente da far
 * decidere a nessuno, il task nasce come è sempre nato.
 */
let commerciale = "";
let amministrativa = "";
let dealId = "";
let statoTarget = "";

beforeAll(async () => {
  const amm = await prisma.user.create({
    data: {
      email: "amm@test.local",
      name: "Anna Amministrativa",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("prova1234"),
    },
  });
  amministrativa = amm.id;
  const com = await prisma.user.create({
    data: {
      email: "com@test.local",
      name: "Carla Commerciale",
      role: UserRole.MEMBER,
      billingAssigneeId: amm.id,
    },
  });
  commerciale = com.id;

  const stato = await prisma.taskStatus.findFirst({
    where: { category: ActivityCategory.ADMIN, isWonTarget: true },
  });
  statoTarget =
    stato?.id ??
    (await prisma.taskStatus.findFirstOrThrow({ where: { category: ActivityCategory.ADMIN } })).id;

  const fase = await prisma.dealStage.create({
    data: { name: "Vinta (prova)", color: "#0a0", order: 99, isWon: true },
  });
  const statoDeal = await prisma.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.SALES },
  });
  const deal = await prisma.task.create({
    data: {
      kind: TaskKind.DEAL,
      title: "Atlante SDK - 2 licenze",
      description: "<p>Due licenze, pagamento a 30 giorni.</p>",
      statusId: statoDeal.id,
      creatorId: com.id,
      assigneeId: com.id,
      dealStageId: fase.id,
      dealValue: 2000,
    },
  });
  dealId = deal.id;
});

describe("il task amministrativo di un'offerta vinta", () => {
  it("nasce con il titolo dell'offerta, lo segue chi ha venduto, lo lavora l'amministrativa", async () => {
    const id = await ensureWonDealTask(dealId, { id: commerciale }, null);
    expect(id, "il task non è stato creato").not.toBeNull();

    const task = await prisma.task.findUniqueOrThrow({ where: { id: id! } });
    expect(task.kind).toBe(TaskKind.ADMIN);
    expect(task.title).toBe("Atlante SDK - 2 licenze");
    // chi ha venduto resta supervisore, l'amministrativo di riferimento la lavora
    expect(task.supervisorId).toBe(commerciale);
    expect(task.assigneeId).toBe(amministrativa);
    expect(task.statusId).toBe(statoTarget);
    expect(task.sourceDealId).toBe(dealId);
    // scadenza a oggi: è una cosa da fare adesso, non un promemoria
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  it("non nasce due volte: se poi qualcuno applica la proposta non si sdoppia", async () => {
    const secondo = await ensureWonDealTask(dealId, { id: commerciale }, null);
    expect(secondo, "un secondo task sugli stessi soldi").toBeNull();
    expect(await prisma.task.count({ where: { sourceDealId: dealId } })).toBe(1);
  });

  it("l'amministrativa viene avvisata: è lei che deve muoversi", async () => {
    const avvisi = await prisma.notification.findMany({ where: { userId: amministrativa } });
    expect(avvisi.length).toBeGreaterThan(0);
  });
});

/**
 * **Gli allegati del contratto devono aprirsi a chi riceve il task.**
 *
 * L'offerta li ha, il task amministrativo li condivide dalla tabella ponte — i
 * file non si duplicano — ma condividere la riga non serve a niente se poi il
 * permesso guarda solo il task da cui l'allegato è partito: l'amministrativa si
 * ritroverebbe il contratto in elenco e un errore aprendolo (04/09/2026).
 */
describe("gli allegati che il task porta con sé", () => {
  it("l'amministrativa che riceve il task apre il contratto dell'offerta", async () => {
    const app = await buildApp();
    const allegato = await prisma.attachment.create({
      data: {
        type: "FILE",
        name: "Purchase order.pdf",
        path: "prova/purchase-order.pdf",
        mimeType: "application/pdf",
        size: 1234,
        uploadedById: commerciale,
        tasks: { create: { taskId: dealId } },
      },
    });

    // Il task nasce (o c'è già dai test sopra) e si porta dietro l'allegato.
    await ensureWonDealTask(dealId, { id: commerciale }, null);
    const task = await prisma.task.findFirstOrThrow({ where: { sourceDealId: dealId } });
    // L'allegato aggiunto DOPO va collegato come fa la proposta applicata.
    await prisma.taskAttachment.upsert({
      where: { taskId_attachmentId: { taskId: task.id, attachmentId: allegato.id } },
      create: { taskId: task.id, attachmentId: allegato.id },
      update: {},
    });

    const accesso = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "amm@test.local", password: "prova1234" },
    });
    const cookie = `${SESSION_COOKIE}=${accesso.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;

    const apri = await app.inject({
      method: "GET",
      url: `/api/attachments/${allegato.id}/open?intent=view`,
      headers: { cookie },
    });
    expect(
      apri.statusCode,
      "l'amministrativa non può aprire il contratto del task che le è stato dato",
    ).toBe(200);
    // Un PDF si legge a schermo: non deve ricadere sul download
    expect((apri.json() as { mode: string }).mode).toBe("viewer");
  });
});
