// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("m7b");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;
let memberCookie: string;
let lostStageId: string;
let openStageId: string;

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
  await prisma.user.create({
    data: {
      email: "member@test.local",
      name: "Member",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("member1234"),
      groups: { create: { groupId: everyone.id } },
    },
  });

  // Stato aperto della categoria amministrativa (creato dalle migrazioni).
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  const open = await prisma.dealStage.create({
    data: { name: "Trattativa", color: "#f59e0b", order: 0 },
  });
  const lost = await prisma.dealStage.create({
    data: { name: "Persa", color: "#ef4444", order: 1, isLost: true },
  });
  openStageId = open.id;
  lostStageId = lost.id;

  // 5 task con titoli ordinabili.
  for (const title of ["Alfa", "Bravo", "Charlie", "Delta", "Echo"]) {
    await prisma.task.create({
      data: { kind: "ADMIN", title, statusId: status.id, creatorId: admin.id },
    });
  }

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
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("paginazione e ordinamento", () => {
  it("paginates tasks with a total count", async () => {
    const page1 = await app.inject({
      method: "GET",
      url: "/api/tasks?page=1&pageSize=2&sortBy=title&sortDir=asc",
      headers: { cookie: adminCookie },
    });
    expect(page1.json().total).toBe(5);
    expect(page1.json().items.map((t: { title: string }) => t.title)).toEqual(["Alfa", "Bravo"]);

    const page3 = await app.inject({
      method: "GET",
      url: "/api/tasks?page=3&pageSize=2&sortBy=title&sortDir=asc",
      headers: { cookie: adminCookie },
    });
    expect(page3.json().items.map((t: { title: string }) => t.title)).toEqual(["Echo"]);
  });

  it("sorts descending", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?pageSize=1&sortBy=title&sortDir=desc",
      headers: { cookie: adminCookie },
    });
    expect(response.json().items[0].title).toBe("Echo");
  });
});

describe("motivo della perdita", () => {
  it("stores the lost reason with the stage change and logs it", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Offerta sfortunata", stageId: openStageId, dealValue: 1000 },
    });
    const dealId = created.json().id;

    const lost = await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { stageId: lostStageId, lostReason: "Prezzo troppo alto per il cliente" },
    });
    expect(lost.statusCode).toBe(200);
    expect(lost.json().lostReason).toBe("Prezzo troppo alto per il cliente");

    const activities = await app.inject({
      method: "GET",
      url: `/api/tasks/${dealId}/activities`,
      headers: { cookie: adminCookie },
    });
    const stageActivity = activities
      .json()
      .items.find((a: { action: string }) => a.action === "stage_changed");
    expect(stageActivity.payload.reason).toBe("Prezzo troppo alto per il cliente");
  });
});

describe("chiusura mese timesheet", () => {
  const MONTH = "2026-06";

  it("admin locks a month and edits are rejected, then unlocks", async () => {
    const status = await prisma.taskStatus.findFirstOrThrow();
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const task = await prisma.task.create({
      data: { kind: "ADMIN", title: "Ore giugno", statusId: status.id, creatorId: admin.id },
    });

    // Prima del lock si può registrare.
    const before = await app.inject({
      method: "PUT",
      url: "/api/timesheet/entry",
      headers: { cookie: memberCookie },
      payload: { taskId: task.id, date: "2026-06-10", hours: 4 },
    });
    expect(before.statusCode).toBe(200);

    // Solo l'admin può chiudere il mese.
    const denied = await app.inject({
      method: "PUT",
      url: `/api/timesheet/locks/${MONTH}`,
      headers: { cookie: memberCookie },
      payload: { locked: true },
    });
    expect(denied.statusCode).toBe(403);

    const locked = await app.inject({
      method: "PUT",
      url: `/api/timesheet/locks/${MONTH}`,
      headers: { cookie: adminCookie },
      payload: { locked: true },
    });
    expect(locked.statusCode).toBe(200);

    // Griglia in sola lettura + modifiche respinte.
    const grid = await app.inject({
      method: "GET",
      url: `/api/timesheet?month=${MONTH}`,
      headers: { cookie: memberCookie },
    });
    expect(grid.json().locked).toBe(true);
    expect(grid.json().editable).toBe(false);

    const edit = await app.inject({
      method: "PUT",
      url: "/api/timesheet/entry",
      headers: { cookie: memberCookie },
      payload: { taskId: task.id, date: "2026-06-11", hours: 2 },
    });
    expect(edit.statusCode).toBe(400);
    expect(edit.body).toContain("chiuso");

    const deleteRow = await app.inject({
      method: "DELETE",
      url: `/api/timesheet/rows/${task.id}?period=${MONTH}`,
      headers: { cookie: memberCookie },
    });
    expect(deleteRow.statusCode).toBe(400);

    // Riapertura: le modifiche tornano possibili.
    await app.inject({
      method: "PUT",
      url: `/api/timesheet/locks/${MONTH}`,
      headers: { cookie: adminCookie },
      payload: { locked: false },
    });
    const after = await app.inject({
      method: "PUT",
      url: "/api/timesheet/entry",
      headers: { cookie: memberCookie },
      payload: { taskId: task.id, date: "2026-06-11", hours: 2 },
    });
    expect(after.statusCode).toBe(200);
  });
});
