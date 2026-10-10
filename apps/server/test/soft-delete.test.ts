// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ProjectRole, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("trash");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma, prismaRaw } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { purgeTrash } = await import("../src/modules/trash/service");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;
let memberCookie: string;
let adminId: string;
let openStatusId: string;
let closedStatusId: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

beforeAll(async () => {
  const everyone = await prisma.group.create({ data: { name: "Tutti" } });
  await prisma.visibilitySetting.createMany({
    data: [
      { scope: "ADMIN_TASKS", groupId: everyone.id },
      { scope: "DEALS", groupId: everyone.id },
    ],
  });
  const admin = await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
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
      groups: { create: { groupId: everyone.id } },
    },
  });
  const open = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  const closed = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: true },
    orderBy: { order: "asc" },
  });
  openStatusId = open.id;
  closedStatusId = closed.id;
  await prisma.dealStage.create({ data: { name: "Trattativa", color: "#f59e0b", order: 0 } });

  // Questi test leggono i messaggi in italiano (scritti prima del multilingua).
  // Gli utenti appena creati nascono con locale "auto" (default di prodotto →
  // inglese): si dichiara la lingua, come fa il setup web con changeLanguage("it").
  await prisma.user.updateMany({ data: { locale: "it" } });
  app = await buildApp();
  adminCookie = await loginCookie("admin@test.local", "admin1234");
  memberCookie = await loginCookie("member@test.local", "member1234");
});

afterAll(async () => {
  await app.close();
  await prismaRaw.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("soft delete di task con subtask", () => {
  it("cascades to subtasks, keeps hours, and restore brings back the cascade only", async () => {
    // Progetto con padre + 2 subtask, di cui uno eliminato in anticipo.
    const project = await prisma.project.create({
      data: {
        name: "Progetto Cestino",
        members: { create: { userId: adminId, role: ProjectRole.MANAGER } },
      },
    });
    const parent = await prisma.task.create({
      data: {
        kind: "PROJECT",
        title: "Padre",
        statusId: openStatusId,
        creatorId: adminId,
        projectId: project.id,
      },
    });
    const child1 = await prisma.task.create({
      data: {
        kind: "PROJECT",
        title: "Figlio 1",
        statusId: openStatusId,
        creatorId: adminId,
        projectId: project.id,
        parentTaskId: parent.id,
      },
    });
    const child2 = await prisma.task.create({
      data: {
        kind: "PROJECT",
        title: "Figlio 2 (già eliminato)",
        statusId: openStatusId,
        creatorId: adminId,
        projectId: project.id,
        parentTaskId: parent.id,
      },
    });
    // Ore registrate sul padre: devono sopravvivere all'eliminazione.
    await prisma.timeEntry.create({
      data: {
        userId: adminId,
        taskId: parent.id,
        date: new Date("2026-07-01T00:00:00Z"),
        hours: 3,
      },
    });
    // child2 eliminato singolarmente PRIMA del padre.
    await app.inject({
      method: "DELETE",
      url: `/api/tasks/${child2.id}`,
      headers: { cookie: adminCookie },
    });

    // Eliminazione del padre → cascata su child1.
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${parent.id}`,
      headers: { cookie: adminCookie },
    });
    expect(deleted.statusCode).toBe(204);

    const list = await app.inject({
      method: "GET",
      url: `/api/tasks?projectId=${project.id}&includeClosed=true`,
      headers: { cookie: adminCookie },
    });
    expect(list.json().items).toHaveLength(0);
    // Il dettaglio del task eliminato non è raggiungibile.
    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${parent.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(404);
    // Le ore esistono ancora.
    expect(await prismaRaw.timeEntry.count({ where: { taskId: parent.id } })).toBe(1);

    // Ripristino del padre: torna child1 (stessa cascata), NON child2.
    const restore = await app.inject({
      method: "POST",
      url: "/api/trash/restore",
      headers: { cookie: adminCookie },
      payload: { type: "task", id: parent.id },
    });
    expect(restore.statusCode).toBe(204);
    const after = await app.inject({
      method: "GET",
      url: `/api/tasks?projectId=${project.id}&includeClosed=true`,
      headers: { cookie: adminCookie },
    });
    const titles = after.json().items.map((t: { title: string }) => t.title);
    expect(titles).toContain("Padre");
    expect(titles).toContain("Figlio 1");
    expect(titles).not.toContain("Figlio 2 (già eliminato)");

    // Ripristinare un subtask col padre nel cestino è bloccato.
    await app.inject({
      method: "DELETE",
      url: `/api/tasks/${parent.id}`,
      headers: { cookie: adminCookie },
    });
    const blocked = await app.inject({
      method: "POST",
      url: "/api/trash/restore",
      headers: { cookie: adminCookie },
      payload: { type: "task", id: child1.id },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("padre");
  });
});

describe("anagrafiche e offerte", () => {
  it("a deal keeps a marked reference to a deleted company and contact", async () => {
    const company = await app.inject({
      method: "POST",
      url: "/api/companies",
      headers: { cookie: adminCookie },
      payload: { name: "Fantasma S.r.l." },
    });
    const companyId = company.json().id;
    const contact = await app.inject({
      method: "POST",
      url: "/api/contacts",
      headers: { cookie: adminCookie },
      payload: { firstName: "Gino", lastName: "Sparito", companyId },
    });
    const contactId = contact.json().id;
    const deal = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Offerta orfana?", companyId, contactId, dealValue: 100 },
    });
    const dealId = deal.json().id;

    await app.inject({
      method: "DELETE",
      url: `/api/companies/${companyId}`,
      headers: { cookie: adminCookie },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/contacts/${contactId}`,
      headers: { cookie: adminCookie },
    });

    // L'azienda sparisce dalle liste ma l'offerta NON è orfana: marcatore visibile.
    const companies = await app.inject({
      method: "GET",
      url: "/api/companies",
      headers: { cookie: adminCookie },
    });
    expect(companies.json().items.some((c: { id: string }) => c.id === companyId)).toBe(false);

    const dealDetail = await app.inject({
      method: "GET",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
    });
    expect(dealDetail.json().company.name).toBe("Fantasma S.r.l. (eliminata)");
    expect(dealDetail.json().contact.name).toBe("Gino Sparito (eliminato)");

    // Il ripristino toglie il marcatore.
    await app.inject({
      method: "POST",
      url: "/api/trash/restore",
      headers: { cookie: adminCookie },
      payload: { type: "company", id: companyId },
    });
    const restored = await app.inject({
      method: "GET",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
    });
    expect(restored.json().company.name).toBe("Fantasma S.r.l.");
  });
});

describe("sequenze e cestino", () => {
  it("a trashed predecessor no longer blocks the chain", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Propedeutico da cestinare" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Successivo", predecessorId: first.json().id },
    });

    await app.inject({
      method: "DELETE",
      url: `/api/tasks/${first.json().id}`,
      headers: { cookie: adminCookie },
    });

    // Nessun 409: il propedeutico nel cestino non blocca.
    const closed = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${second.json().id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: closedStatusId },
    });
    expect(closed.statusCode).toBe(200);
  });
});

describe("cestino: permessi, eliminazione definitiva e purge", () => {
  it("trash is admin-only and lists deleted items", async () => {
    const denied = await app.inject({
      method: "GET",
      url: "/api/trash",
      headers: { cookie: memberCookie },
    });
    expect(denied.statusCode).toBe(403);

    const trash = await app.inject({
      method: "GET",
      url: "/api/trash",
      headers: { cookie: adminCookie },
    });
    expect(trash.statusCode).toBe(200);
    expect(trash.json().items.length).toBeGreaterThan(0);
  });

  it("hard delete removes the record permanently", async () => {
    const task = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Da distruggere" },
    });
    const taskId = task.json().id;
    await app.inject({
      method: "DELETE",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: adminCookie },
    });
    const destroyed = await app.inject({
      method: "DELETE",
      url: `/api/trash/task/${taskId}`,
      headers: { cookie: adminCookie },
    });
    expect(destroyed.statusCode).toBe(204);
    expect(await prismaRaw.task.findUnique({ where: { id: taskId } })).toBeNull();
  });

  it("purge hard-deletes items older than the retention window", async () => {
    const task = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Vecchio nel cestino" },
    });
    const taskId = task.json().id;
    // Nel cestino da 60 giorni (retention 30).
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 60);
    await prismaRaw.task.update({ where: { id: taskId }, data: { deletedAt: old } });

    const purged = await purgeTrash();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await prismaRaw.task.findUnique({ where: { id: taskId } })).toBeNull();
  });

  it("svuota il cestino in un colpo solo, e solo per l'admin", async () => {
    // Due elementi freschi nel cestino: il purge automatico non li toccherebbe
    // (retention 30 giorni), lo svuotamento manuale sì.
    const ids: string[] = [];
    for (const title of ["Da svuotare 1", "Da svuotare 2"]) {
      const created = await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: { cookie: adminCookie },
        payload: { title },
      });
      const id = created.json().id as string;
      ids.push(id);
      await app.inject({
        method: "DELETE",
        url: `/api/tasks/${id}`,
        headers: { cookie: adminCookie },
      });
    }

    // Un membro non può svuotare il cestino.
    const forbidden = await app.inject({
      method: "DELETE",
      url: "/api/trash",
      headers: { cookie: memberCookie },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(await prismaRaw.task.findUnique({ where: { id: ids[0]! } })).not.toBeNull();

    const emptied = await app.inject({
      method: "DELETE",
      url: "/api/trash",
      headers: { cookie: adminCookie },
    });
    expect(emptied.statusCode).toBe(200);
    expect(emptied.json().purged).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      expect(await prismaRaw.task.findUnique({ where: { id } })).toBeNull();
    }

    // Il cestino è vuoto e i task ancora vivi non sono stati toccati.
    const trash = await app.inject({
      method: "GET",
      url: "/api/trash",
      headers: { cookie: adminCookie },
    });
    expect(trash.json().items).toHaveLength(0);
    expect(await prismaRaw.task.count({ where: { deletedAt: null } })).toBeGreaterThan(0);
  });

  it("keeps trashed records out of groupBy and aggregate", async () => {
    // I facet dei filtri e la media dei valori passano da groupBy/aggregate: senza
    // il filtro nell'estensione, un task nel cestino continuerebbe a comparire
    // nelle tendine e a spostare le medie.
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Task che finisce nel cestino" },
    });
    const taskId = created.json().id as string;

    const before = await prisma.task.groupBy({ by: ["statusId"], _count: { _all: true } });
    const countBefore = before.reduce((sum, row) => sum + row._count._all, 0);

    await app.inject({
      method: "DELETE",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: adminCookie },
    });

    const after = await prisma.task.groupBy({ by: ["statusId"], _count: { _all: true } });
    const countAfter = after.reduce((sum, row) => sum + row._count._all, 0);
    expect(countAfter).toBe(countBefore - 1);

    // Il client raw continua a contarli: serve al cestino e al purge.
    const raw = await prismaRaw.task.groupBy({ by: ["statusId"], _count: { _all: true } });
    expect(raw.reduce((sum, row) => sum + row._count._all, 0)).toBe(await prismaRaw.task.count());
  });
});
