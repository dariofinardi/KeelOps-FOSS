// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, NotificationType, TaskKind, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("wip");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const { wipBreaches, wipLoads, wipMessage, sortBreaches } =
  await import("../src/modules/task-statuses/wip");
const { sendDueDigests } = await import("../src/modules/notifications/service");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let devCookie: string;
let managerId: string;
let devId: string;
let projectId: string;
let inProgressId: string;
let todoId: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

/** Un task del progetto in uno stato, per riempire la colonna. */
async function task(title: string, statusId: string) {
  return prisma.task.create({
    data: {
      title,
      kind: TaskKind.PROJECT,
      projectId,
      statusId,
      creatorId: devId,
      assigneeId: devId,
    },
  });
}

beforeAll(async () => {
  const manager = await prisma.user.create({
    data: {
      email: "manager@test.local",
      name: "Manuela Manager",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("manager1234"),
    },
  });
  managerId = manager.id;
  const dev = await prisma.user.create({
    data: {
      email: "dev@test.local",
      name: "Dora Dev",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("dev12345"),
    },
  });
  devId = dev.id;

  const project = await prisma.project.create({
    data: {
      name: "Atlante - Bug/Fixing",
      members: {
        create: [
          { userId: manager.id, role: "MANAGER" },
          { userId: dev.id, role: "EDITOR" },
        ],
      },
    },
  });
  projectId = project.id;

  const inProgress = await prisma.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.DEV, name: "In sviluppo" },
  });
  inProgressId = inProgress.id;
  todoId = (
    await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.DEV, name: "Da fare" },
    })
  ).id;
  // Il limite: tre task insieme in "In sviluppo", per progetto.
  await prisma.taskStatus.update({ where: { id: inProgressId }, data: { wipLimit: 3 } });

  app = await buildApp();
  devCookie = await loginCookie("dev@test.local", "dev12345");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("limite WIP", () => {
  it("dentro il limite non è una violazione; oltre sì", async () => {
    const creati = [
      await task("Uno", inProgressId),
      await task("Due", inProgressId),
      await task("Tre", inProgressId),
    ];
    expect(await wipBreaches({ projectId })).toEqual([]);

    creati.push(await task("Quattro", inProgressId));
    const [breach] = await wipBreaches({ projectId });
    expect(breach).toMatchObject({
      projectName: "Atlante - Bug/Fixing",
      statusName: "In sviluppo",
      userName: "Dora Dev",
      count: 4,
      limit: 3,
    });

    await prisma.task.deleteMany({ where: { id: { in: creati.map((c) => c.id) } } });
  });

  it("il limite è di ognuno, non della colonna: due persone non si sommano", async () => {
    // Il difetto corretto il 18/08/2026: contando per progetto, tre task a
    // schermo mostravano 11/4 — undici erano il totale di tutti.
    const creati = [];
    for (let i = 0; i < 3; i += 1) creati.push(await task(`Dora ${i}`, inProgressId));
    for (let i = 0; i < 3; i += 1) {
      const altrui = await task(`Altri ${i}`, inProgressId);
      await prisma.task.update({ where: { id: altrui.id }, data: { assigneeId: managerId } });
      creati.push(altrui);
    }
    // Sei in colonna, ma tre a testa: nessuno è oltre il limite di 3.
    expect(await wipBreaches({ projectId })).toEqual([]);
    await prisma.task.deleteMany({ where: { id: { in: creati.map((c) => c.id) } } });
  });

  it("i task senza assegnatario non sono il lavoro in corso di nessuno", async () => {
    const creati = [];
    for (let i = 0; i < 9; i += 1) {
      const orfano = await task(`Da prendere ${i}`, inProgressId);
      await prisma.task.update({ where: { id: orfano.id }, data: { assigneeId: null } });
      creati.push(orfano);
    }
    expect(await wipBreaches({ projectId })).toEqual([]);
    await prisma.task.deleteMany({ where: { id: { in: creati.map((c) => c.id) } } });
  });

  /**
   * **Chi lavora il task, non chi lo guarda.** È la domanda che si fa chi legge
   * il pannello dell'andamento: quel numero da dove viene? Da un solo campo,
   * `assigneeId`. Supervisionare trenta task non è avere trenta cose in mano, e
   * nemmeno averli aperti: chi ha creato una richiesta non la sta lavorando —
   * in Orione - Bug/Fixing c'era chi risultava supervisore di ventuno richieste
   * aperte da qualcun altro (20/08/2026).
   */
  it("conta i task assegnati: non chi supervisiona, non chi ha creato", async () => {
    const creati = [];
    for (let i = 0; i < 9; i += 1) {
      const altrui = await task(`In mano al manager ${i}`, inProgressId);
      // Dora li ha creati tutti e li supervisiona tutti; a lavorarli è Manuela.
      await prisma.task.update({
        where: { id: altrui.id },
        data: { assigneeId: managerId, creatorId: devId, supervisorId: devId },
      });
      creati.push(altrui);
    }
    const carichi = await wipLoads({ projectId });
    expect(carichi.map((carico) => carico.userName)).toEqual(["Manuela Manager"]);
    expect(carichi[0]).toMatchObject({ count: 9, limit: 3, level: "oltre" });
    await prisma.task.deleteMany({ where: { id: { in: creati.map((c) => c.id) } } });
  });

  /**
   * Esattamente al limite non è una violazione — non si avvisa nessuno — ma è
   * la condizione in cui la prossima cosa presa in carico lo diventa, ed è lì
   * che si può ancora decidere. Il pannello la mostra, la campanella no.
   */
  it("al limite è attenzione, non violazione: si vede nel pannello, non nelle notifiche", async () => {
    const creati = [
      await task("Uno", inProgressId),
      await task("Due", inProgressId),
      await task("Tre", inProgressId),
    ];
    const carichi = await wipLoads({ projectId });
    expect(carichi).toHaveLength(1);
    expect(carichi[0]).toMatchObject({ count: 3, limit: 3, level: "attenzione" });
    expect(await wipBreaches({ projectId })).toEqual([]);

    creati.push(await task("Quattro", inProgressId));
    expect((await wipLoads({ projectId }))[0]).toMatchObject({ count: 4, level: "oltre" });
    expect(await wipBreaches({ projectId })).toHaveLength(1);
    await prisma.task.deleteMany({ where: { id: { in: creati.map((c) => c.id) } } });
  });

  it("uno stato senza limite non è mai una violazione, per quanti ce ne siano", async () => {
    const creati = [];
    for (let i = 0; i < 12; i += 1) creati.push(await task(`Da fare ${i}`, todoId));
    expect(await wipBreaches({ projectId })).toEqual([]);
    await prisma.task.deleteMany({ where: { id: { in: creati.map((c) => c.id) } } });
  });

  it("i task nel cestino non gonfiano il conteggio", async () => {
    // Chi ha cestinato un task non ci sta lavorando: contarlo direbbe che la
    // colonna è piena di lavoro che nessuno vede.
    const vivi = [await task("A", inProgressId), await task("B", inProgressId)];
    const cestinati = [await task("C", inProgressId), await task("D", inProgressId)];
    await prisma.task.updateMany({
      where: { id: { in: cestinati.map((c) => c.id) } },
      data: { deletedAt: new Date() },
    });
    expect(await wipBreaches({ projectId })).toEqual([]);
    await prisma.task.deleteMany({
      where: { id: { in: [...vivi, ...cestinati].map((c) => c.id) } },
    });
  });

  it("la frase dice il fatto, il limite e cosa fare", () => {
    const frase = wipMessage(
      (key, params) => {
        let out = key;
        for (const [k, v] of Object.entries(params ?? {}))
          out = out.replaceAll(`{{${k}}}`, String(v));
        return out;
      },
      {
        projectId: "p",
        projectName: "Atlante - Bug/Fixing",
        statusId: "s",
        statusName: "In sviluppo",
        userId: "u",
        userName: "Alex Bianchi",
        count: 7,
        limit: 3,
      },
    );
    expect(frase).toContain("Atlante - Bug/Fixing");
    expect(frase).toContain("Alex Bianchi");
    expect(frase).toContain("7");
    expect(frase).toContain("In sviluppo");
    expect(frase).toContain("3");
    // Non si ferma al rimprovero: dice anche cosa fare.
    expect(frase).toMatch(/prima di cominciarne altre/);
  });

  it("le violazioni più gravi vengono prima", () => {
    const b = (name: string, count: number, limit: number) => ({
      projectId: name,
      projectName: name,
      statusId: "s",
      statusName: "In sviluppo",
      userId: "u",
      userName: "Alex Bianchi",
      count,
      limit,
    });
    expect(sortBreaches([b("poco", 4, 3), b("tanto", 12, 3)]).map((x) => x.projectName)).toEqual([
      "tanto",
      "poco",
    ]);
  });

  it("avvisa i manager del progetto nel momento in cui si supera, una volta sola", async () => {
    const dentro = [
      await task("W1", inProgressId),
      await task("W2", inProgressId),
      await task("W3", inProgressId),
    ];
    // Il quarto entra spostandolo: è il passaggio della soglia.
    const quarto = await task("W4", todoId);
    const move = async (id: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/tasks/${id}`,
        // Sposta lo sviluppatore, non il manager: le notifiche non tornano a
        // chi ha fatto la modifica, e qui il destinatario è il manager.
        headers: { cookie: devCookie },
        payload: { statusId: inProgressId },
      });
    expect((await move(quarto.id)).statusCode).toBe(200);

    const avvisi = await prisma.notification.findMany({
      where: { userId: managerId, type: NotificationType.WIP_LIMIT },
    });
    expect(avvisi).toHaveLength(1);
    expect(JSON.parse(avvisi[0]!.payload).text).toContain("In sviluppo");

    // Il quinto è già oltre: non si ripete. Un avviso che torna a ogni
    // spostamento diventa rumore che si impara a ignorare.
    const quinto = await task("W5", todoId);
    await move(quinto.id);
    expect(
      await prisma.notification.count({
        where: { userId: managerId, type: NotificationType.WIP_LIMIT },
      }),
    ).toBe(1);

    await prisma.task.deleteMany({
      where: { id: { in: [...dentro.map((d) => d.id), quarto.id, quinto.id] } },
    });
  });

  it("il riepilogo della mattina porta la frase a chi guida il progetto", async () => {
    const creati = [];
    for (let i = 0; i < 5; i += 1) creati.push(await task(`M${i}`, inProgressId));

    await sendDueDigests(new Date());
    const digest = await prisma.notification.findFirstOrThrow({
      where: { userId: managerId, type: NotificationType.DUE_DIGEST },
      orderBy: { createdAt: "desc" },
    });
    const testo = JSON.parse(digest.payload).text as string;
    expect(testo).toContain("Atlante - Bug/Fixing");
    expect(testo).toContain("In sviluppo");

    // Arriva anche a chi quei task ce li ha in mano: è la sua giornata, ed è
    // lei che può chiudere qualcosa prima di aprire altro.
    const suo = await prisma.notification.findFirstOrThrow({
      where: { userId: devId, type: NotificationType.DUE_DIGEST },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.parse(suo.payload).text).toContain("Dora Dev");

    await prisma.task.deleteMany({ where: { id: { in: creati.map((c) => c.id) } } });
  });
});

describe("limite WIP — superato assegnando, non spostando", () => {
  it("il quarto task assegnato a chi ne ha già tre nello stato avvisa come il quarto spostato", async () => {
    const inProgress = inProgressId;
    const tre = [];
    for (let i = 0; i < 3; i += 1) tre.push(await task(`A${i}`, inProgress));
    // Il quarto è già "In sviluppo" ma di nessuno: l'assegnazione è il gesto
    // che fa superare il limite, e non tocca lo stato.
    const quarto = await task("A3", inProgress);
    await prisma.task.update({ where: { id: quarto.id }, data: { assigneeId: null } });
    await prisma.notification.deleteMany({ where: { type: NotificationType.WIP_LIMIT } });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${quarto.id}`,
      headers: { cookie: devCookie },
      payload: { assigneeId: devId },
    });
    expect(res.statusCode).toBe(200);
    expect(
      await prisma.notification.count({ where: { type: NotificationType.WIP_LIMIT } }),
    ).toBeGreaterThan(0);

    await prisma.task.deleteMany({
      where: { id: { in: [...tre.map((t) => t.id), quarto.id] } },
    });
  });
});
