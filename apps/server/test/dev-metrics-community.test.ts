// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActivityCategory, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

process.env.KEELOPS_EDITION = "community";
prepareTestDb("dev-metrics-community");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * **«L'andamento» in the community edition** (08/10/2026): the dev manager's
 * panel is core — weekly flow, open work by status, WIP limits, hours per
 * project, and the delays of each person.
 */
let app: App;
let cookie: string;

beforeAll(async () => {
  const pw = await hashPassword("password-1234");
  const capo = await prisma.user.create({
    data: { email: "capo@dev.local", name: "Carla Capo", role: UserRole.MEMBER, passwordHash: pw },
  });
  const dev = await prisma.user.create({
    data: { email: "dev@dev.local", name: "Dora Dev", role: UserRole.MEMBER, passwordHash: pw },
  });
  const gruppo = await prisma.group.create({
    data: { name: "Sviluppo", managedArea: ActivityCategory.DEV },
  });
  await prisma.groupMember.createMany({
    data: [
      { groupId: gruppo.id, userId: capo.id, isManager: true },
      { groupId: gruppo.id, userId: dev.id },
    ],
  });
  const aperto = await prisma.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.DEV, isClosed: false },
    orderBy: { order: "asc" },
  });
  const progetto = await prisma.project.create({ data: { name: "Gestionale" } });
  const task = (title: string, dueDate: Date | null) =>
    prisma.task.create({
      data: {
        kind: "PROJECT",
        title,
        projectId: progetto.id,
        statusId: aperto.id,
        creatorId: capo.id,
        assigneeId: dev.id,
        dueDate,
      },
    });
  await task("In ritardo", new Date("2020-01-01T00:00:00.000Z"));
  await task("Ancora in tempo", new Date("2099-01-01T00:00:00.000Z"));
  await task("Senza scadenza", null);

  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "capo@dev.local", password: "password-1234" },
  });
  cookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
});

afterAll(async () => {
  await app?.close();
});

describe("«L'andamento», community edition", () => {
  it("the manager of the dev area sees it, with each person's delays", async () => {
    const me = (
      await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })
    ).json();
    expect(me.canSeeDevMetrics).toBe(true);
    const r = await app.inject({
      method: "GET",
      url: "/api/dashboard/dev-metrics",
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      team: { aperti: number };
      people: Array<{ name: string; assegnati: number; inRitardo: number }>;
    };
    expect(body.team.aperti).toBe(3);
    expect(body.people.find((p) => p.name === "Dora Dev")).toMatchObject({
      assegnati: 3,
      inRitardo: 1,
    });
  });
});
