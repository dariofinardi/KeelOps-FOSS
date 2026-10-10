// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

prepareTestDb("task-due");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * **Il filtro di scadenza delle bacheche** (10/09/2026).
 *
 * Segnalazione: scegliendo «7 giorni» sparivano anche i task *senza* data. In
 * una bacheca kanban una card che sparisce si legge come un record perso, non
 * come un filtro che ha funzionato: il range serve a stringere sulle scadenze,
 * non a nascondere il lavoro che una scadenza non ce l'ha.
 *
 * La regola vive in due posti — `inDueRange` in `@kancrm/shared` (le liste che
 * filtrano in pagina, tipo il dettaglio progetto) e la query qui sotto — e i
 * due devono dire la stessa cosa. Qui si prova il lato server, compresi i
 * numeri delle tendine, che si contano con lo stesso `where`.
 */

let app: App;
let cookie: string;
let scadutoId: string;
let vicinoId: string;
let lontanoId: string;
let senzaDataId: string;

/** Data ISO a N giorni da oggi: il server confronta con l'oggi vero. */
const fraGiorni = (n: number) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      passwordHash: await hashPassword("admin1234"),
    },
  });
  const statusId = (
    await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.ADMIN, isClosed: false },
    })
  ).id;

  const comune = { kind: TaskKind.ADMIN, statusId, assigneeId: admin.id, creatorId: admin.id };
  const [scaduto, vicino, lontano, senza] = await Promise.all([
    prisma.task.create({ data: { ...comune, title: "Scaduto", dueDate: fraGiorni(-10) } }),
    prisma.task.create({ data: { ...comune, title: "Entro pochi giorni", dueDate: fraGiorni(3) } }),
    prisma.task.create({ data: { ...comune, title: "Il mese prossimo", dueDate: fraGiorni(40) } }),
    prisma.task.create({ data: { ...comune, title: "Senza scadenza", dueDate: null } }),
  ]);
  scadutoId = scaduto.id;
  vicinoId = vicino.id;
  lontanoId = lontano.id;
  senzaDataId = senza.id;

  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "admin@test.local", password: "admin1234" },
  });
  cookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
});

afterAll(async () => {
  await app?.close();
});

const lista = async (query: string) => {
  const response = await app.inject({
    method: "GET",
    url: `/api/tasks?includeProjectTasks=true&pageSize=100${query}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    items: Array<{ id: string; title: string }>;
    total: number;
    facets: { statuses: Array<{ id: string; name: string; count: number }> };
  };
};

describe("filtrare le bacheche per scadenza", () => {
  it("tiene dentro chi non ha data, insieme a scaduti e finestra", async () => {
    const { items } = await lista("&dueWithinDays=7");
    const ids = items.map((i) => i.id);
    expect(ids).toContain(senzaDataId);
    expect(ids).toContain(scadutoId);
    expect(ids).toContain(vicinoId);
    expect(ids).not.toContain(lontanoId);
  });

  it("allargando la finestra entra anche la scadenza lontana", async () => {
    const ids = (await lista("&dueWithinDays=60")).items.map((i) => i.id);
    expect(ids).toContain(lontanoId);
    expect(ids).toContain(senzaDataId);
  });

  it("senza filtro non cambia niente", async () => {
    expect((await lista("")).items).toHaveLength(4);
  });

  it("i numeri delle tendine contano gli stessi task della lista", async () => {
    // Le tendine si contano con lo stesso `where`: se il range restasse fuori
    // dall'AND — o vi entrasse in modo diverso — il numero accanto alla voce
    // non tornerebbe con le righe mostrate.
    const { items, total, facets } = await lista("&dueWithinDays=7");
    expect(total).toBe(items.length);
    expect(facets.statuses.reduce((somma, s) => somma + s.count, 0)).toBe(items.length);
  });

  it("il range convive con la ricerca per testo invece di sovrascriverla", async () => {
    // `q` mette un `OR` in cima al where: il range deve stare nell'AND, o uno
    // dei due filtri sparirebbe silenziosamente.
    const ids = (await lista("&dueWithinDays=7&q=Senza")).items.map((i) => i.id);
    expect(ids).toEqual([senzaDataId]);
  });
});
