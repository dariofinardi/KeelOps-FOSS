// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("statuscat");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let cookie = "";
let fatturaTypeId = "";
let sviluppoTypeId = "";

/** Primo stato (aperto) di una categoria. */
async function firstStatus(category: ActivityCategory, closed = false) {
  return prisma.taskStatus.findFirstOrThrow({
    where: { category, isClosed: closed },
    orderBy: { order: "asc" },
  });
}

async function createTask(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload });
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
      passwordHash: await hashPassword("admin1234"),
    },
  });
  const fattura = await prisma.activityType.create({
    data: {
      name: "Emissione fattura",
      category: ActivityCategory.ADMIN,
      color: "#f59e0b",
      order: 0,
    },
  });
  const sviluppo = await prisma.activityType.create({
    data: { name: "Sviluppo", category: ActivityCategory.DEV, color: "#22c55e", order: 1 },
  });
  fatturaTypeId = fattura.id;
  sviluppoTypeId = sviluppo.id;

  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "admin@test.local", password: "admin1234" },
  });
  cookie = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("stati per categoria di attività", () => {
  it("le migrazioni creano una lista per ogni categoria", async () => {
    for (const category of Object.values(ActivityCategory)) {
      const count = await prisma.taskStatus.count({ where: { category } });
      expect(count, `categoria ${category}`).toBeGreaterThan(0);
    }
  });

  it("il task nasce nel primo stato della categoria del suo tipo di attività", async () => {
    const admin = await createTask({
      title: "Fattura di settembre",
      activityTypeId: fatturaTypeId,
    });
    expect(admin.statusCode).toBe(201);
    expect(admin.json().status.category).toBe(ActivityCategory.ADMIN);
    expect(admin.json().status.id).toBe((await firstStatus(ActivityCategory.ADMIN)).id);

    const dev = await createTask({ title: "Nuova API", activityTypeId: sviluppoTypeId });
    expect(dev.json().status.category).toBe(ActivityCategory.DEV);

    // Senza tipo di attività decide il modulo (vedi il test successivo).
    const generico = await createTask({ title: "Task senza tipo" });
    expect(generico.json().status.category).toBe(ActivityCategory.ADMIN);
  });

  it("i tipi Generali sono trasversali: non spostano il task in un flusso a parte", async () => {
    const generico = await prisma.activityType.create({
      data: {
        name: "Riunione",
        category: ActivityCategory.GENERAL,
        color: "#6b7280",
        order: 9,
        isMeeting: true,
      },
    });
    // Una riunione nello scadenzario resta amministrativa (non finisce nei Generali).
    const task = await createTask({ title: "Riunione mensile", activityTypeId: generico.id });
    expect(task.json().status.category).toBe(ActivityCategory.ADMIN);
  });

  it("il task dello scadenzario senza tipo usa gli stati amministrativi", async () => {
    // Senza tipo di attività decide il modulo: lo scadenzario è amministrativo,
    // così l'occorrenza di una ricorrenza nasce in "Da assegnare" e compare nella
    // bacheca giusta.
    const task = await createTask({ title: "Versamento IVA mensile" });
    expect(task.json().status.category).toBe(ActivityCategory.ADMIN);
    expect(task.json().status.id).toBe((await firstStatus(ActivityCategory.ADMIN)).id);
  });

  it("rifiuta uno stato di un'altra categoria, in creazione e in modifica", async () => {
    const devStatus = await firstStatus(ActivityCategory.DEV);

    const created = await createTask({
      title: "Fattura con stato sbagliato",
      activityTypeId: fatturaTypeId,
      statusId: devStatus.id,
    });
    expect(created.statusCode).toBe(400);

    const task = await createTask({ title: "Fattura corretta", activityTypeId: fatturaTypeId });
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.json().id}`,
      headers: { cookie },
      payload: { statusId: devStatus.id },
    });
    expect(patched.statusCode).toBe(400);
  });

  it("cambiando tipo di attività lo stato passa alla lista della nuova categoria", async () => {
    const task = await createTask({
      title: "Da amministrativo a sviluppo",
      activityTypeId: fatturaTypeId,
    });
    const id = task.json().id as string;

    // Portalo in uno stato chiuso amministrativo…
    const adminClosed = await firstStatus(ActivityCategory.ADMIN, true);
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${id}`,
      headers: { cookie },
      payload: { statusId: adminClosed.id },
    });

    // …e cambia il tipo: lo stato deve seguire, restando chiuso.
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${id}`,
      headers: { cookie },
      payload: { activityTypeId: sviluppoTypeId },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().status.category).toBe(ActivityCategory.DEV);
    expect(moved.json().status.isClosed).toBe(true);
  });

  it('un task assegnato non resta in "Da assegnare"', async () => {
    const assegnato = await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.ADMIN, isAssignedTarget: true },
    });
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.local" } });

    // Nasce già assegnato → parte dallo stato dei task assegnati.
    const withAssignee = await createTask({
      title: "Fattura con responsabile",
      activityTypeId: fatturaTypeId,
      assigneeId: admin.id,
    });
    expect(withAssignee.json().status.id).toBe(assegnato.id);

    // Nasce libero → primo stato; riceve un assegnatario → ci passa da solo.
    const free = await createTask({ title: "Fattura da assegnare", activityTypeId: fatturaTypeId });
    expect(free.json().status.id).toBe((await firstStatus(ActivityCategory.ADMIN)).id);
    const assigned = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${free.json().id}`,
      headers: { cookie },
      payload: { assigneeId: admin.id },
    });
    expect(assigned.json().status.id).toBe(assegnato.id);

    // Ma un task già in lavorazione non torna indietro quando cambia assegnatario.
    const inProgress = await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.ADMIN, name: "In esecuzione" },
    });
    const started = await createTask({ title: "Già in corso", activityTypeId: fatturaTypeId });
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${started.json().id}`,
      headers: { cookie },
      payload: { statusId: inProgress.id },
    });
    const reassigned = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${started.json().id}`,
      headers: { cookie },
      payload: { assigneeId: admin.id },
    });
    expect(reassigned.json().status.id).toBe(inProgress.id);
  });

  it("l'admin crea stati dentro una categoria e non può svuotarla", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie },
      payload: { name: "In collaudo", category: ActivityCategory.DEV, color: "#f59e0b" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().category).toBe(ActivityCategory.DEV);

    // Stesso nome, altra categoria: consentito (l'unicità è per categoria).
    const twin = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie },
      payload: { name: "In collaudo", category: ActivityCategory.ADMIN, color: "#f59e0b" },
    });
    expect(twin.statusCode).toBe(201);

    // Stesso nome nella stessa categoria: rifiutato.
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie },
      payload: { name: "In collaudo", category: ActivityCategory.DEV, color: "#f59e0b" },
    });
    expect(duplicate.statusCode).toBe(409);

    // Il riordino non può mescolare categorie diverse.
    const mixed = await app.inject({
      method: "PUT",
      url: "/api/task-statuses/reorder",
      headers: { cookie },
      payload: {
        ids: [created.json().id, (await firstStatus(ActivityCategory.ADMIN)).id],
      },
    });
    expect(mixed.statusCode).toBe(400);
  });
});
