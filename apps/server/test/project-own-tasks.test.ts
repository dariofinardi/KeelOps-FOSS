// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

prepareTestDb("project-own-tasks");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * **Chi entra in un progetto solo perché ci ha del lavoro, cosa ci vede.**
 *
 * I propri task, non quelli degli altri. "Propri" comprende **anche quelli che
 * ha creato** — un task aperto per un collega resta suo da seguire — ma non le
 * **richieste**: quelle si aprono dall'area ticket, dove si leggono e si
 * risponde, e ricomparire dentro il progetto vuol dire vedere due volte la
 * stessa cosa in due posti (20/08/2026: su Atlante erano otto richieste in mezzo
 * a centoundici task).
 */
let app: App;
let cookie: string;
let progettoId: string;

beforeAll(async () => {
  const [io, altro] = await Promise.all([
    prisma.user.create({
      data: {
        email: "io@test.local",
        name: "Io",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("prova1234"),
      },
    }),
    prisma.user.create({
      data: {
        email: "altro@test.local",
        name: "Un altro",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("prova1234"),
      },
    }),
  ]);
  const progetto = await prisma.project.create({
    data: {
      name: "Atlante di prova",
      members: { create: [{ userId: altro.id, role: "MANAGER" }] },
    },
  });
  progettoId = progetto.id;
  const stato = await prisma.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.DEV },
    orderBy: { order: "asc" },
  });
  const base = { kind: TaskKind.PROJECT, statusId: stato.id, projectId: progetto.id };
  await prisma.task.createMany({
    data: [
      // Ci entra per questo: ne supervisiona uno.
      { ...base, title: "Supervisionato da me", creatorId: altro.id, supervisorId: io.id },
      // Creato da lui per un collega: resta suo da seguire.
      { ...base, title: "Creato da me per un collega", creatorId: io.id, assigneeId: altro.id },
      // Richiesta aperta da lui: la legge dall'area ticket.
      {
        ...base,
        title: "Richiesta che ho aperto",
        creatorId: io.id,
        assigneeId: altro.id,
        createdViaTicket: true,
      },
      // Roba di altri: non lo riguarda.
      { ...base, title: "Task di un altro", creatorId: altro.id, assigneeId: altro.id },
    ],
  });

  app = await buildApp();
  const accesso = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "io@test.local", password: "prova1234" },
  });
  cookie = accesso.headers["set-cookie"]!.toString().split(";")[0]!;
});

afterAll(async () => {
  await app?.close();
});

const titoliNelProgetto = async () => {
  const risposta = await app.inject({
    method: "GET",
    url: `/api/tasks?projectId=${progettoId}&pageSize=100`,
    headers: { cookie },
  });
  expect(risposta.statusCode).toBe(200);
  return (risposta.json() as { items: Array<{ title: string }> }).items.map((t) => t.title).sort();
};

describe("il progetto visto da chi non è membro", () => {
  it("mostra ciò che segue e ciò che ha aperto, non le richieste né il lavoro altrui", async () => {
    expect(await titoliNelProgetto()).toEqual([
      "Creato da me per un collega",
      "Supervisionato da me",
    ]);
  });

  /**
   * **Il rifiuto deve dire la verità a chi il task ce l'ha aperto davanti.**
   *
   * Il 404 sui progetti altrui serve a non rivelarne l'esistenza, e va bene per
   * chi il task non lo vede. Al supervisore no: guarda il task, prova a passare
   * la supervisione al capoprogetto e legge "Progetto non trovato" — di un
   * progetto che ha sotto gli occhi (20/08/2026).
   */
  it("il task che segue arriva in sola lettura: il pannello non offre campi che il server rifiuta", async () => {
    const task = await prisma.task.findFirstOrThrow({ where: { title: "Supervisionato da me" } });
    const risposta = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers: { cookie },
    });
    expect(risposta.statusCode).toBe(200);
    expect(risposta.json()).toMatchObject({ canEdit: false, canDelete: false });
  });

  it("e se prova lo stesso a cambiare il supervisore, gli spiega perché invece di negare il progetto", async () => {
    const task = await prisma.task.findFirstOrThrow({ where: { title: "Supervisionato da me" } });
    const capo = await prisma.user.findFirstOrThrow({ where: { email: "altro@test.local" } });
    const risposta = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { cookie },
      payload: { supervisorId: capo.id },
    });
    expect(risposta.statusCode).toBe(403);
    // La lingua dei test è l'inglese: il messaggio arriva tradotto, ed è
    // proprio quello che si vuole verificare — parla di appartenenza al
    // progetto, non della sua esistenza.
    expect((risposta.json() as { message: string }).message).toContain(
      "not a member of this project",
    );
  });

  it("la richiesta che ha aperto resta raggiungibile: non è sparita, è altrove", async () => {
    // Toglierla dal progetto non deve volere dire perderla: il perimetro
    // generale tiene il creatore, quindi la ricerca la trova ancora.
    const risposta = await app.inject({
      method: "GET",
      url: "/api/search?q=Richiesta%20che%20ho%20aperto",
      headers: { cookie },
    });
    expect(risposta.statusCode).toBe(200);
    const titoli = (risposta.json() as Array<{ title: string }>).map((r) => r.title);
    expect(titoli).toContain("Richiesta che ho aperto");
  });
});
