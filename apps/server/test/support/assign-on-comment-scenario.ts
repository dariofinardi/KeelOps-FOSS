// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { UserRole } from "@kancrm/shared";

/**
 * The world of the "a comment does not take a task" tests (assign-on-comment,
 * core, and commercial/assign-on-comment-ticket): an elevated admin who keeps
 * the desk, two members of a project, the helpers to write and to find a
 * status. Split out on 08/10/2026 so both editions share one setup.
 */
export async function assignOnCommentScenario() {
  const { buildApp } = await import("../../src/app");
  const { prisma } = await import("../../src/db");
  const { hashPassword } = await import("../../src/modules/auth/password");
  const { SESSION_COOKIE } = await import("../../src/modules/auth/session");

  const cookie: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const everyone = await prisma.group.create({ data: { name: "Tutti" } });
  await prisma.visibilitySetting.createMany({
    data: [
      { scope: "ADMIN_TASKS", groupId: everyone.id },
      { scope: "TICKETS", groupId: everyone.id },
      { scope: "DEALS", groupId: everyone.id },
    ],
  });
  const passwordHash = await hashPassword("giusta-1234");
  for (const [k, role] of [
    ["desk", UserRole.ADMIN],
    ["anna", UserRole.MEMBER],
    ["bruno", UserRole.MEMBER],
  ] as const) {
    ids[k] = (
      await prisma.user.create({
        data: {
          email: `${k}@x.local`,
          name: k,
          role,
          passwordHash,
          ...(k === "desk" ? { adminUntil: new Date("2099-01-01") } : {}),
        },
      })
    ).id;
  }
  await prisma.groupMember.createMany({
    data: [
      { groupId: everyone.id, userId: ids.anna! },
      { groupId: everyone.id, userId: ids.bruno! },
      { groupId: everyone.id, userId: ids.desk! },
    ],
  });
  ids.progetto = (await prisma.project.create({ data: { name: "Gestionale" } })).id;
  await prisma.projectMember.createMany({
    data: [
      { projectId: ids.progetto, userId: ids.anna!, role: "EDITOR" },
      { projectId: ids.progetto, userId: ids.bruno!, role: "EDITOR" },
    ],
  });
  const app = await buildApp();
  const login = async (email: string) => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "giusta-1234" },
    });
    return `${SESSION_COOKIE}=${r.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  };
  for (const k of ["desk", "anna", "bruno"]) cookie[k] = await login(`${k}@x.local`);

  const scrivi = (chi: string, taskId: string, body = "Ci penso io.") =>
    app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/comments`,
      headers: { cookie: cookie[chi]! },
      payload: { body },
    });
  const stato = (category: string, extra: object = {}) =>
    prisma.taskStatus.findFirstOrThrow({
      where: { category, isClosed: false, ...extra },
      orderBy: { order: "asc" },
    });
  const nuovoTask = async (data: Record<string, unknown>) =>
    (
      await prisma.task.create({
        data: { title: "Da fare", creatorId: ids.desk!, ...data } as never,
      })
    ).id;
  return { app, prisma, cookie, ids, scrivi, stato, nuovoTask };
}
