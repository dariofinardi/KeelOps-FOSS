import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

prepareTestDb("task-duplicate");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * **Duplicare un task** (19/08/2026): si copia cosa c'è da fare, non cosa è
 * stato fatto. Il confine tra le due cose è il punto della funzione.
 */
let app: App;
let cookie: string;
let statusId: string;
let userId: string;
let originaleId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      passwordHash: await hashPassword("admin1234"),
      locale: "it",
    },
  });
  userId = user.id;
  statusId = (
    await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.ADMIN, isClosed: false },
    })
  ).id;
  const tag = await prisma.tag.create({ data: { name: "urgente", color: "#f00" } });

  const originale = await prisma.task.create({
    data: {
      kind: TaskKind.ADMIN,
      title: "Verifica bilancio",
      description: "<p>Con la nota del commercialista</p>",
      statusId,
      creatorId: user.id,
      assigneeId: user.id,
      supervisorId: user.id,
      dueDate: new Date("2026-09-01T00:00:00.000Z"),
      tags: { create: [{ tagId: tag.id }] },
      comments: { create: [{ authorId: user.id, body: "Fatto ieri" }] },
      activities: { create: [{ userId: user.id, action: "created" }] },
    },
  });
  originaleId = originale.id;

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

const duplica = async (id: string, locale = "it") => {
  const response = await app.inject({
    method: "POST",
    url: `/api/tasks/${id}/duplicate`,
    headers: { cookie, "x-locale": locale },
  });
  return response;
};

describe("duplicare un task", () => {
  it("la copia porta il numero nel titolo e riprende la definizione", async () => {
    const response = await duplica(originaleId);
    expect(response.statusCode).toBe(201);
    const { id, title } = response.json() as { id: string; title: string };
    expect(title).toBe("Verifica bilancio (copia 1)");

    const copia = await prisma.task.findUniqueOrThrow({
      where: { id },
      include: { tags: true, comments: true },
    });
    expect(copia.description).toBe("<p>Con la nota del commercialista</p>");
    expect(copia.statusId).toBe(statusId);
    expect(copia.assigneeId).toBe(userId);
    expect(copia.dueDate?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(copia.tags).toHaveLength(1);
  });

  it("non copia la storia: i commenti restano dell'originale", async () => {
    // Un duplicato serve a rifare un lavoro simile, non a raccontare che è
    // già stato fatto.
    const response = await duplica(originaleId);
    const { id } = response.json() as { id: string };
    const copia = await prisma.task.findUniqueOrThrow({
      where: { id },
      include: { comments: true },
    });
    expect(copia.comments).toEqual([]);
  });

  it("la seconda copia prende il numero successivo, non ripete il primo", async () => {
    const titoli = (
      await prisma.task.findMany({ where: { title: { startsWith: "Verifica bilancio" } } })
    ).map((t) => t.title);
    expect(titoli).toContain("Verifica bilancio (copia 1)");
    expect(titoli).toContain("Verifica bilancio (copia 2)");
  });

  it("duplicare una copia riparte dal titolo base", async () => {
    const copia1 = await prisma.task.findFirstOrThrow({
      where: { title: "Verifica bilancio (copia 1)" },
    });
    const response = await duplica(copia1.id);
    const { title } = response.json() as { title: string };
    // Non "Verifica bilancio (copia 1) (copia 1)".
    expect(title).toMatch(/^Verifica bilancio \(copia \d+\)$/);
  });

  it("il suffisso segue la lingua di chi duplica", async () => {
    // La lingua attiva la manda il client in `X-Locale`: la preferenza salvata
    // può essere "auto", e allora la vera lingua la sa solo il browser.
    const response = await duplica(originaleId, "en");
    const { title } = response.json() as { title: string };
    expect(title).toMatch(/^Verifica bilancio \(copy \d+\)$/);
  });

  it("un'offerta non si duplica da qui", async () => {
    const deal = await prisma.task.create({
      data: { kind: TaskKind.DEAL, title: "Portale Acme", statusId, creatorId: userId },
    });
    const response = await duplica(deal.id);
    expect(response.statusCode).toBe(400);
  });
});
