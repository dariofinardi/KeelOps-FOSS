// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { ProjectRole, UserRole } from "@kancrm/shared";

/**
 * A small world for the timesheet summaries, shared by the commercial and the
 * community tests: a project managed by Paola, worked on by Willy; Willy logs
 * 3 h in the week of Monday 6 July 2026 and 5 h in the week of Monday 20 July,
 * Paola 2 h in the first week. Returns the app and a cookie per person.
 */
export async function hoursScenario() {
  const { buildApp } = await import("../../src/app");
  const { prisma } = await import("../../src/db");
  const { hashPassword } = await import("../../src/modules/auth/password");
  const { SESSION_COOKIE } = await import("../../src/modules/auth/session");

  const persona = async (email: string, name: string, role: string = UserRole.MEMBER) =>
    prisma.user.create({
      data: {
        email,
        name,
        role,
        passwordHash: await hashPassword("password-1234"),
        // an elevated administrator (see auth/elevation): sees everything
        ...(role === UserRole.ADMIN ? { adminUntil: new Date("2099-01-01") } : {}),
      },
    });
  await persona("admin@hours.local", "Admin", UserRole.ADMIN);
  const worker = await persona("worker@hours.local", "Willy Worker");
  const manager = await persona("pm@hours.local", "Paola PM");
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "DEV", isClosed: false },
  });
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
  const task = await prisma.task.create({
    data: {
      kind: "PROJECT",
      title: "Sviluppo",
      projectId: project.id,
      statusId: status.id,
      creatorId: manager.id,
      assigneeId: worker.id,
      supervisorId: manager.id,
    },
  });
  const ore = (userId: string, day: string, hours: number) =>
    prisma.timeEntry.create({
      data: { userId, taskId: task.id, date: new Date(`${day}T00:00:00.000Z`), hours },
    });
  await ore(worker.id, "2026-07-06", 3);
  await ore(worker.id, "2026-07-20", 5);
  await ore(manager.id, "2026-07-07", 2);

  const app = await buildApp();
  const login = async (email: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "password-1234" },
    });
    return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };
  return {
    app,
    workerId: worker.id,
    cookies: {
      admin: await login("admin@hours.local"),
      worker: await login("worker@hours.local"),
      manager: await login("pm@hours.local"),
    },
  };
}
