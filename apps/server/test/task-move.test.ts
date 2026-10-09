import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ProjectRole, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("move");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie = "";
let editorCookie = "";
let projectId = "";
let dealId = "";

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "password-1" },
  });
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

async function createTask(payload: Record<string, unknown>, cookie = adminCookie) {
  return app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload });
}

async function move(taskId: string, payload: Record<string, unknown>, cookie = adminCookie) {
  return app.inject({ method: "PATCH", url: `/api/tasks/${taskId}`, headers: { cookie }, payload });
}

beforeAll(async () => {
  const passwordHash = await hashPassword("password-1");
  const admin = await prisma.user.create({
    data: { email: "admin@test.local", name: "Admin", role: UserRole.ADMIN, adminUntil: new Date("2099-01-01"), passwordHash },
  });
  const editor = await prisma.user.create({
    data: { email: "editor@test.local", name: "Editor", role: UserRole.MEMBER, passwordHash },
  });
  const project = await prisma.project.create({
    data: {
      name: "Piattaforma",
      members: {
        create: [
          { userId: admin.id, role: ProjectRole.MANAGER },
          { userId: editor.id, role: ProjectRole.EDITOR },
        ],
      },
    },
  });
  projectId = project.id;

  // Un'offerta a cui collegare i task.
  const stage = await prisma.dealStage.create({
    data: { name: "Trattativa", color: "#f59e0b", order: 0 },
  });
  const generalStatus = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "GENERAL", isClosed: false },
    orderBy: { order: "asc" },
  });
  const deal = await prisma.task.create({
    data: {
      kind: "DEAL",
      title: "Fornitura 2027",
      statusId: generalStatus.id,
      dealStageId: stage.id,
      creatorId: admin.id,
    },
  });
  dealId = deal.id;

  // Questi test leggono i messaggi in italiano (scritti prima del multilingua).
  // Gli utenti appena creati nascono con locale "auto" (default di prodotto →
  // inglese): si dichiara la lingua, come fa il setup web con changeLanguage("it").
  await prisma.user.updateMany({ data: { locale: "it" } });
  app = await buildApp();
  adminCookie = await login("admin@test.local");
  editorCookie = await login("editor@test.local");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("spostamento di un task tra scadenzario, progetti e offerte", () => {
  it("porta un task dello scadenzario in un progetto, rimappando lo stato", async () => {
    const created = await createTask({ title: "Analisi requisiti" });
    const id = created.json().id as string;
    expect(created.json().kind).toBe("ADMIN");
    expect(created.json().status.category).toBe("ADMIN");

    const moved = await move(id, { projectId });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().kind).toBe("PROJECT");
    expect(moved.json().projectId).toBe(projectId);
    // Lo stato passa alla lista del nuovo modulo (sviluppo), restando aperto.
    expect(moved.json().status.category).toBe("DEV");
    expect(moved.json().status.isClosed).toBe(false);

    // Lo spostamento resta nella cronologia.
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { taskId: id, action: "moved" },
    });
    expect(JSON.parse(log.payload!)).toEqual({
      from: "Scadenzario",
      to: "Progetto: Piattaforma",
    });
  });

  it("riporta il task nello scadenzario, ma solo per un manager del progetto", async () => {
    const created = await createTask({ title: "Da riportare indietro" });
    const id = created.json().id as string;
    await move(id, { projectId });

    // L'editor può lavorare nel progetto ma non portare via il task.
    const byEditor = await move(id, { projectId: null }, editorCookie);
    expect(byEditor.statusCode).toBe(403);

    const byManager = await move(id, { projectId: null });
    expect(byManager.statusCode).toBe(200);
    expect(byManager.json().kind).toBe("ADMIN");
    expect(byManager.json().projectId).toBeNull();
    expect(byManager.json().status.category).toBe("ADMIN");
  });

  it("collega un task all'offerta senza cambiarne la visibilità", async () => {
    const created = await createTask({ title: "Preparare preventivo" });
    const id = created.json().id as string;

    const linked = await move(id, { relatedDealId: dealId });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().kind).toBe("ADMIN");
    expect(linked.json().relatedDeal).toMatchObject({ title: "Fornitura 2027" });

    // Entrando in un progetto il collegamento all'offerta cade: sono esclusivi.
    const moved = await move(id, { projectId });
    expect(moved.json().relatedDeal).toBeNull();
    expect(moved.json().projectId).toBe(projectId);
  });

  it("rifiuta le occorrenze di una ricorrenza", async () => {
    const template = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: { title: "Liquidazione IVA", rrule: "FREQ=MONTHLY", dtstart: "2026-07-01" },
    });
    const occurrence = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: template.json().id as string },
    });

    const response = await move(occurrence.id, { projectId });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("ricorrenza");
  });

  it("rifiuta i task con subtask e i subtask stessi", async () => {
    const parent = await createTask({ title: "Padre", projectId });
    const parentId = parent.json().id as string;
    const child = await createTask({ title: "Figlio", projectId, parentTaskId: parentId });

    const movingParent = await move(parentId, { projectId: null });
    expect(movingParent.statusCode).toBe(400);
    expect(movingParent.json().message).toContain("subtask");

    const movingChild = await move(child.json().id as string, { projectId: null });
    expect(movingChild.statusCode).toBe(400);
  });

  it("rifiuta lo spostamento di offerte e ticket", async () => {
    const response = await move(dealId, { projectId });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("scadenzario");
  });

  it("un task amministrativo si collega a un cliente, con i nomi in cronologia", async () => {
    const acme = await prisma.company.create({ data: { name: "Acme Diretta" } });
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Scadenza cliente diretto" },
    });
    const taskId = created.json().id as string;

    const linked = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: adminCookie },
      payload: { companyId: acme.id },
    });
    expect(linked.statusCode).toBe(200);
    // Il cliente esce risolto nel DTO, come per i task nati da un'offerta.
    expect(linked.json().company).toMatchObject({ name: "Acme Diretta" });

    // La cronologia parla per nomi: fra un anno l'id non direbbe niente.
    const voce = await prisma.activityLog.findFirst({
      where: { taskId, action: "company_changed" },
    });
    expect(JSON.parse(voce!.payload!)).toEqual({ from: null, to: "Acme Diretta" });

    // E si scollega: il campo torna vuoto.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: adminCookie },
      payload: { companyId: null },
    });
    expect(cleared.json().company).toBeNull();
  });

  it("il cliente di un'offerta non si cambia dal task", async () => {
    // L'offerta ha il suo pannello: due strade per lo stesso campo divergono.
    const acme = await prisma.company.create({ data: { name: "Acme Offerte" } });
    const deal = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Trattativa con cliente" },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${deal.json().id}`,
      headers: { cookie: adminCookie },
      payload: { companyId: acme.id },
    });
    expect(res.statusCode).toBe(400);
  });

  it("l'azienda si compila da sola dal progetto, e il cliente diretto vince", async () => {
    // "Se un task viene associato a offerta o progetto, l'azienda si compila in
    // automatico": derivata, non copiata — se cambia sul progetto, cambia qui.
    const cliente = await prisma.company.create({ data: { name: "Cliente del progetto" } });
    const progetto = await prisma.project.create({
      data: { name: "Commessa con cliente", companyId: cliente.id },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Task nella commessa", projectId: progetto.id },
    });
    expect(created.json().company).toMatchObject({ name: "Cliente del progetto" });

    // Un cliente impostato a mano sul task vince sulla derivazione.
    const altra = await prisma.company.create({ data: { name: "Cliente specifico" } });
    const overridden = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${created.json().id}`,
      headers: { cookie: adminCookie },
      payload: { companyId: altra.id },
    });
    expect(overridden.json().company).toMatchObject({ name: "Cliente specifico" });

    // Tolto il diretto, riaffiora quello del progetto: la derivazione è viva.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${created.json().id}`,
      headers: { cookie: adminCookie },
      payload: { companyId: null },
    });
    expect(cleared.json().company).toMatchObject({ name: "Cliente del progetto" });
  });
});
