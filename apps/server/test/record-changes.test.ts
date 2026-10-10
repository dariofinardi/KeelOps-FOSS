// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("recordchanges");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const { addSseListener } = await import("../src/modules/notifications/service");
const { recipientsOf } = await import("../src/modules/realtime/record-changes");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
const PW = "password-di-prova-1";

let assegnatario = { id: "" };
let supervisore = { id: "" };
let autore = { id: "" };
let estraneo = { id: "" };
let taskId = "";

const cookies = new Map<string, string>();
async function cookie(email: string): Promise<string> {
  const cached = cookies.get(email);
  if (cached) return cached;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: PW },
  });
  const value = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const header = `${SESSION_COOKIE}=${value}`;
  cookies.set(email, header);
  return header;
}

/** Raccoglie gli eventi spinti verso un utente, già decodificati. */
function listen(userId: string) {
  const events: Array<Record<string, unknown>> = [];
  const stop = addSseListener(userId, (data) => {
    for (const line of data.split("\n")) {
      if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
    }
  });
  return { events, stop };
}

const changes = (events: Array<Record<string, unknown>>) =>
  events.filter((event) => event.kind === "record-changed");

beforeAll(async () => {
  const hash = await hashPassword(PW);
  const utente = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, role: UserRole.ADMIN, adminUntil: new Date("2099-01-01"), passwordHash: hash } });
  assegnatario = await utente("assegnatario@x.local", "Assegnatario");
  supervisore = await utente("supervisore@x.local", "Supervisore");
  autore = await utente("autore@x.local", "Autore");
  estraneo = await utente("estraneo@x.local", "Estraneo");

  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.ADMIN, isClosed: false },
  });
  const task = await prisma.task.create({
    data: {
      title: "Task guardato da più persone",
      kind: TaskKind.ADMIN,
      statusId: status.id,
      creatorId: autore.id,
      assigneeId: assegnatario.id,
      supervisorId: supervisore.id,
    },
  });
  taskId = task.id;
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

/** L'avviso parte dopo la risposta: si lascia girare il giro di eventi. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("chi va avvisato di un record cambiato", () => {
  it("assegnatario, supervisore e creatore — mai chi ha fatto la modifica", () => {
    const task = { assigneeId: "a", supervisorId: "s", creatorId: "c" };
    expect(recipientsOf(task, "x").sort()).toEqual(["a", "c", "s"]);
    expect(recipientsOf(task, "a").sort()).toEqual(["c", "s"]);
    // Stessa persona in più ruoli: un avviso solo.
    expect(recipientsOf({ assigneeId: "a", supervisorId: "a", creatorId: "a" }, "x")).toEqual([
      "a",
    ]);
    expect(recipientsOf({ assigneeId: null, supervisorId: null, creatorId: "c" }, "c")).toEqual([]);
  });
});

describe("avviso in tempo reale", () => {
  it("arriva a chi ha il record in mano, non a chi l'ha modificato", async () => {
    const dellAssegnatario = listen(assegnatario.id);
    const delSupervisore = listen(supervisore.id);
    const dellAutore = listen(autore.id);
    const dellEstraneo = listen(estraneo.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: await cookie("autore@x.local") },
      payload: { title: "Titolo cambiato da chi l'ha creato" },
    });
    expect(res.statusCode).toBe(200);
    await settle();

    const avviso = changes(dellAssegnatario.events);
    expect(avviso).toHaveLength(1);
    expect(avviso[0]?.records).toEqual([{ id: taskId, kind: TaskKind.ADMIN }]);
    expect(changes(delSupervisore.events)).toHaveLength(1);
    // Chi ha fatto la modifica ha già lo schermo aggiornato: avvisarlo sarebbe
    // dirgli di rileggere quello che ha appena scritto.
    expect(changes(dellAutore.events)).toHaveLength(0);
    // E chi con quel task non c'entra non riceve nulla, nemmeno il suo id.
    expect(changes(dellEstraneo.events)).toHaveLength(0);

    for (const l of [dellAssegnatario, delSupervisore, dellAutore, dellEstraneo]) l.stop();
  });

  it("una richiesta che fallisce non annuncia niente", async () => {
    const ascolto = listen(assegnatario.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: await cookie("autore@x.local") },
      payload: { statusId: "stato-che-non-esiste" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await settle();
    expect(changes(ascolto.events)).toHaveLength(0);
    ascolto.stop();
  });

  it("l'avviso non lascia traccia: non è una notifica", async () => {
    // La campanella resta per ciò che riguarda la persona; questo dice solo che
    // lo schermo è vecchio, e non deve riempire nessun elenco.
    const prima = await prisma.notification.count({ where: { userId: assegnatario.id } });
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: await cookie("autore@x.local") },
      payload: { title: "Ancora un altro titolo" },
    });
    await settle();
    expect(await prisma.notification.count({ where: { userId: assegnatario.id } })).toBe(prima);
  });
});
