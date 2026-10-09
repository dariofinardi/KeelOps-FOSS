// Copyright (c) 2026 Jugaad s.r.l.

import { ProjectRole, UserRole } from "@kancrm/shared";

/**
 * The world of the timesheet tests (m6-timesheet, core, and
 * commercial/m6-timesheet-extras), split out on 08/10/2026: an admin, a
 * worker and a project manager, an admin task, a project the worker belongs to
 * and one he does not.
 */
export async function m6Scenario() {
  const { buildApp } = await import("../../src/app");
  const { prisma } = await import("../../src/db");
  const { hashPassword } = await import("../../src/modules/auth/password");
  const { SESSION_COOKIE } = await import("../../src/modules/auth/session");
  const everyone = await prisma.group.create({ data: { name: "Tutti" } });
  await prisma.visibilitySetting.create({
    data: { scope: "ADMIN_TASKS", groupId: everyone.id },
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
  const worker = await prisma.user.create({
    data: {
      email: "worker@test.local",
      name: "Willy Worker",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("worker1234"),
      groups: { create: { groupId: everyone.id } },
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: "pm@test.local",
      name: "Paola PM",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("pm123456"),
      groups: { create: { groupId: everyone.id } },
    },
  });

  // Stato aperto della categoria amministrativa (creato dalle migrazioni).
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });

  const adminTask = await prisma.task.create({
    data: { kind: "ADMIN", title: "Contabilità", statusId: status.id, creatorId: admin.id },
  });

  // Progetto di cui worker è EDITOR e Paola è MANAGER.
  const project = await prisma.project.create({
    data: {
      name: "Progetto Ore",
      members: {
        create: [
          { userId: manager.id, role: ProjectRole.MANAGER },
          { userId: worker.id, role: ProjectRole.EDITOR },
        ],
      },
    },
  });
  const projectTask = await prisma.task.create({
    data: {
      kind: "PROJECT",
      title: "Sviluppo modulo",
      statusId: status.id,
      creatorId: manager.id,
      projectId: project.id,
    },
  });

  // Progetto a cui worker NON appartiene.
  const hiddenProject = await prisma.project.create({
    data: {
      name: "Progetto Segreto",
      members: { create: [{ userId: manager.id, role: ProjectRole.MANAGER }] },
    },
  });
  const hiddenTask = await prisma.task.create({
    data: {
      kind: "PROJECT",
      title: "Task nascosto",
      statusId: status.id,
      creatorId: manager.id,
      projectId: hiddenProject.id,
    },
  });

  // Questi test leggono i messaggi in italiano (scritti prima del multilingua).
  // Gli utenti appena creati nascono con locale "auto" (default di prodotto →
  // inglese): si dichiara la lingua, come fa il setup web con changeLanguage("it").
  await prisma.user.updateMany({ data: { locale: "it" } });
  const app = await buildApp();
  const loginCookie = async (email: string, password: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };
  const adminCookie = await loginCookie("admin@test.local", "admin1234");
  const workerCookie = await loginCookie("worker@test.local", "worker1234");
  const managerCookie = await loginCookie("pm@test.local", "pm123456");

  const putEntry = async (
    cookie: string,
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: string }> => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/timesheet/entry",
      headers: { cookie },
      payload,
    });
    return { statusCode: response.statusCode, body: response.body };
  };
  return {
    app,
    prisma,
    adminCookie,
    workerCookie,
    managerCookie,
    workerId: worker.id,
    managerId: manager.id,
    adminTaskId: adminTask.id,
    projectTaskId: projectTask.id,
    projectId: project.id,
    hiddenProjectTaskId: hiddenTask.id,
    putEntry,
  };
}

/**
 * May 2027 for the week tests: two admin tasks the worker touched, one in the
 * week of Monday 3 and one in the week of Monday 10.
 */
export async function settimaneDiMaggio(
  prisma: Awaited<ReturnType<typeof m6Scenario>>["prisma"],
  workerId: string,
) {
  const open = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  const uno = await prisma.task.create({
    data: { kind: "ADMIN", title: "Lavorato il 5", statusId: open.id, creatorId: workerId },
  });
  const due = await prisma.task.create({
    data: { kind: "ADMIN", title: "Lavorato il 12", statusId: open.id, creatorId: workerId },
  });
  await prisma.activityLog.createMany({
    data: [
      {
        taskId: uno.id,
        userId: workerId,
        action: "commented",
        createdAt: new Date("2027-05-05T09:00:00.000Z"),
      },
      {
        taskId: due.id,
        userId: workerId,
        action: "commented",
        createdAt: new Date("2027-05-12T09:00:00.000Z"),
      },
    ],
  });
  return { primaSettimana: uno.id, secondaSettimana: due.id };
}
