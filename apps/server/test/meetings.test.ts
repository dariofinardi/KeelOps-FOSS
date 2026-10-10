// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("meetings");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let cookie: string;
let meetingTypeId: string;
let plainTypeId: string;

async function createTask(payload: Record<string, unknown>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/tasks",
    headers: { cookie },
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
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
  // Gli stati arrivano dalle migrazioni: qui basta che esistano quelli GENERAL.
  const meetingType = await prisma.activityType.create({
    data: { name: "Riunione", category: "GENERAL", color: "#64748b", order: 0, isMeeting: true },
  });
  meetingTypeId = meetingType.id;
  const plainType = await prisma.activityType.create({
    data: { name: "Telefonata", category: "SALES", color: "#16a34a", order: 1 },
  });
  plainTypeId = plainType.id;

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

describe("meetings", () => {
  it("lists only tasks whose activity type is a meeting", async () => {
    await createTask({
      title: "SAL settimanale",
      activityTypeId: meetingTypeId,
      dueDate: "2026-07-24",
    });
    await createTask({ title: "Chiamare il cliente", activityTypeId: plainTypeId });

    const response = await app.inject({ method: "GET", url: "/api/meetings", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const meetings = response.json();
    expect(meetings).toHaveLength(1);
    expect(meetings[0].title).toBe("SAL settimanale");
    expect(meetings[0].dueDate).toBe("2026-07-24");
  });

  it("links a task to the meeting it was decided in", async () => {
    const meetingId = await createTask({
      title: "Riunione di aprile",
      activityTypeId: meetingTypeId,
    });
    const taskId = await createTask({ title: "Preparare il preventivo", meetingId });

    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
      headers: { cookie },
    });
    expect(detail.json().meeting).toMatchObject({ id: meetingId, title: "Riunione di aprile" });
  });

  it("rejects a meeting reference that is not a meeting", async () => {
    const plainId = await createTask({ title: "Task qualunque", activityTypeId: plainTypeId });
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie },
      payload: { title: "Figlio", meetingId: plainId },
    });
    expect(response.statusCode).toBe(400);
  });

  it("collects notes of a meeting grouped by discussed task", async () => {
    const meetingId = await createTask({ title: "Comitato", activityTypeId: meetingTypeId });
    const first = await createTask({ title: "Attività A" });
    const second = await createTask({ title: "Attività B" });

    for (const [taskId, body] of [
      [first, "Rivisto lo stato, si prosegue"],
      [first, "Secondo punto sulla stessa attività"],
      [second, "Bloccata in attesa del fornitore"],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/tasks/${taskId}/comments`,
        headers: { cookie },
        payload: { body, meetingId },
      });
      expect(response.statusCode).toBe(201);
    }

    // Una nota senza incontro non finisce nel verbale.
    await app.inject({
      method: "POST",
      url: `/api/tasks/${first}/comments`,
      headers: { cookie },
      payload: { body: "Nota sciolta" },
    });

    const minutes = await app.inject({
      method: "GET",
      url: `/api/meetings/${meetingId}/minutes`,
      headers: { cookie },
    });
    expect(minutes.statusCode).toBe(200);
    const body = minutes.json();
    expect(body.meeting.noteCount).toBe(3);
    expect(body.groups).toHaveLength(2);
    const groupA = body.groups.find((g: { task: { id: string } }) => g.task.id === first);
    expect(groupA.notes).toHaveLength(2);
    expect(groupA.notes[0].body).toBe("Rivisto lo stato, si prosegue");

    // La stessa nota è visibile anche dal task, con il riferimento all'incontro.
    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${first}/comments`,
      headers: { cookie },
    });
    const withMeeting = detail.json().items.filter((c: { meeting: unknown }) => c.meeting);
    expect(withMeeting).toHaveLength(2);
    expect(withMeeting[0].meeting.title).toBe("Comitato");
  });

  it("keeps participants on the meeting task", async () => {
    const meetingId = await createTask({
      title: "Incontro con il cliente",
      activityTypeId: meetingTypeId,
      participants: "AD, DIR, Mario Rossi",
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/meetings",
      headers: { cookie },
    });
    const meeting = response.json().find((m: { id: string }) => m.id === meetingId);
    expect(meeting.participants).toBe("AD, DIR, Mario Rossi");

    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${meetingId}`,
      headers: { cookie },
      payload: { participants: "AD, DIR" },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${meetingId}`,
      headers: { cookie },
    });
    expect(detail.json().participants).toBe("AD, DIR");
  });

  it("returns 404 for minutes of a task that is not a meeting", async () => {
    const plainId = await createTask({ title: "Non è un incontro" });
    const response = await app.inject({
      method: "GET",
      url: `/api/meetings/${plainId}/minutes`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
