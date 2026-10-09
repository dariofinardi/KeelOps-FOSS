import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

prepareTestDb("deal-orphan-edit");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

/**
 * **Un'offerta si deve sempre poter riassegnare.**
 *
 * Il caso vero (22/08/2026): un'offerta senza commerciale, creata da un altro.
 * Per il modello del sudo l'admin non elevato è un utente normale e la vede in
 * sola lettura — giusto. Ma **elevato** deve poterla modificare, assegnazione
 * compresa: se nemmeno lui può, l'offerta resta orfana per sempre.
 */
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie = "";
let saraCookie = "";
let dealId = "";
let saraId = "";

beforeAll(async () => {
  await prisma.user.create({
    data: {
      email: "capo@test.local",
      name: "Capo",
      role: UserRole.ADMIN,
      passwordHash: await hashPassword("capo12345"),
    },
  });
  const sara = await prisma.user.create({
    data: {
      email: "sara@test.local",
      name: "Sara Sales",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("sara12345"),
    },
  });
  saraId = sara.id;
  // Sara lavora le offerte (accesso FULL via gruppo); l'admin no: per lui vale
  // solo l'elevazione, come da modello sudo.
  const commerciali = await prisma.group.create({
    data: { name: "Commerciale", members: { create: { userId: sara.id } } },
  });
  await prisma.visibilitySetting.create({ data: { scope: "DEALS", groupId: commerciali.id } });
  const stage = await prisma.dealStage.create({
    data: { name: "Persa", color: "#ef4444", order: 0, isLost: true },
  });
  const stato = await prisma.taskStatus.create({
    data: { name: "Da fare", color: "#888888", order: 0, category: "ADMIN" },
  });
  const deal = await prisma.task.create({
    data: {
      kind: "DEAL",
      title: "Bando orfano",
      statusId: stato.id,
      dealStageId: stage.id,
      creatorId: sara.id,
      assigneeId: null,
    },
  });
  dealId = deal.id;

  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "capo@test.local", password: "capo12345" },
  });
  adminCookie = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  const loginSara = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "sara@test.local", password: "sara12345" },
  });
  saraCookie = `${SESSION_COOKIE}=${loginSara.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("offerta senza commerciale: chi può riprenderla in mano", () => {
  it("chi lavora le offerte può riprendere in mano un'orfana", async () => {
    // Sara non è né creatrice né assegnataria: senza commerciale, l'offerta è
    // di chiunque abbia accesso pieno — o resterebbe orfana per sempre.
    const res = await app.inject({
      method: "GET",
      url: `/api/deals/${dealId}`,
      headers: { cookie: saraCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().canEdit).toBe(true);
  });

  it("assegnata, torna la regola stretta: solo il suo commerciale", async () => {
    const capo = await prisma.user.create({
      data: { email: "capo2@test.local", name: "Altro Capo", role: UserRole.MEMBER },
    });
    const stage = await prisma.dealStage.findFirstOrThrow();
    const stato = await prisma.taskStatus.findFirstOrThrow();
    const assegnata = await prisma.task.create({
      data: {
        kind: "DEAL",
        title: "Bando assegnato",
        statusId: stato.id,
        dealStageId: stage.id,
        creatorId: saraId,
        assigneeId: capo.id,
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/deals/${assegnata.id}`,
      headers: { cookie: saraCookie },
    });
    expect(res.json().canEdit).toBe(false);
  });

  it("elevato, la può modificare e riassegnare — anche se è chiusa", async () => {
    await app.inject({ method: "POST", url: "/api/auth/elevate", headers: { cookie: adminCookie } });
    const dettaglio = await app.inject({
      method: "GET",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
    });
    expect(dettaglio.json().canEdit).toBe(true);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { assigneeId: saraId },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().assignee?.id).toBe(saraId);
  });
});
