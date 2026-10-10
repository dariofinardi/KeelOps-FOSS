// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { ProjectRole, TaskKind, UserRole } from "@kancrm/shared";

/**
 * The "deal from a task" tests' setup (deal-from-task, core, and
 * commercial/deal-from-task-monitor), split out on 08/10/2026: an admin, a
 * project manager and a developer on a customer's project, a negotiation and a
 * won stage, and a development task with a pasted image.
 */
export const PW = "password-di-prova-1";

export async function dealFromTaskScenario() {
  const { buildApp } = await import("../../src/app");
  const { prisma } = await import("../../src/db");
  const { hashPassword } = await import("../../src/modules/auth/password");
  const { SESSION_COOKIE } = await import("../../src/modules/auth/session");

  const ids: Record<string, string> = {};
  const cookies = new Map<string, string>();
  const hash = await hashPassword(PW);
  const utente = async (email: string, role: UserRole, extra: object = {}) =>
    (
      await prisma.user.create({
        data: { email, name: email.split("@")[0]!, role, passwordHash: hash, ...extra },
      })
    ).id;
  ids.admin = await utente("admin@x.local", UserRole.ADMIN, { adminUntil: new Date("2099-01-01") });
  ids.pm = await utente("pm@x.local", UserRole.MEMBER);
  ids.dev = await utente("dev@x.local", UserRole.MEMBER);
  ids.cliente = (await prisma.company.create({ data: { name: "Studio Rossi" } })).id;
  ids.progetto = (
    await prisma.project.create({
      data: {
        name: "Portale Rossi",
        companyId: ids.cliente,
        members: {
          create: [
            { userId: ids.pm, role: ProjectRole.MANAGER },
            { userId: ids.dev, role: ProjectRole.EDITOR },
          ],
        },
      },
    })
  ).id;
  await prisma.dealStage.create({ data: { name: "Trattativa", color: "#000", order: 0 } });
  ids.vinta = (
    await prisma.dealStage.create({ data: { name: "Vinta", color: "#000", order: 1, isWon: true } })
  ).id;
  const stato = await prisma.taskStatus.findFirstOrThrow({ where: { category: "DEV" } });
  ids.task = (
    await prisma.task.create({
      data: {
        kind: TaskKind.PROJECT,
        title: "Esportazione in PDF/A",
        description: `<p>Serve il PDF/A-2b.</p><p><img src="/api/tasks/PLACEHOLDER/inline/schermo.png"></p>`,
        statusId: stato.id,
        projectId: ids.progetto,
        creatorId: ids.dev,
        assigneeId: ids.dev,
      },
    })
  ).id;
  // l'immagine incollata punta al task stesso, come quelle vere
  await prisma.task.update({
    where: { id: ids.task },
    data: {
      description: `<p>Serve il PDF/A-2b.</p><p><img src="/api/tasks/${ids.task}/inline/schermo.png"></p>`,
    },
  });
  const app = await buildApp();

  async function cookie(email: string): Promise<string> {
    if (cookies.has(email)) return cookies.get(email)!;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: PW },
    });
    const header = `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
    cookies.set(email, header);
    return header;
  }
  const chiama = async (
    email: string,
    method: "GET" | "POST" | "PATCH",
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie: await cookie(email) },
      ...(payload ? { payload } : {}),
    });

  return { app, prisma, ids, utente, chiama };
}
