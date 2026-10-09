import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("statusmerge");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;
let memberCookie: string;
let adminId: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

/** Uno stato nuovo nell'area di sviluppo, in coda. */
async function devStatus(name: string, isClosed = false) {
  const last = await prisma.taskStatus.findFirst({
    where: { category: ActivityCategory.DEV },
    orderBy: { order: "desc" },
  });
  return prisma.taskStatus.create({
    data: {
      name,
      category: ActivityCategory.DEV,
      color: "#60a5fa",
      order: (last?.order ?? -1) + 1,
      isClosed,
    },
  });
}

async function devTask(title: string, statusId: string, extra: { deletedAt?: Date } = {}) {
  return prisma.task.create({
    data: {
      title,
      kind: TaskKind.PROJECT,
      statusId,
      creatorId: adminId,
      assigneeId: adminId,
      ...extra,
    },
  });
}

const merge = (sourceId: string, targetId: string, cookie = adminCookie) =>
  app.inject({
    method: "POST",
    url: `/api/task-statuses/${sourceId}/merge`,
    headers: { cookie },
    payload: { targetId },
  });

const previewMerge = (sourceId: string, targetId: string) =>
  app.inject({
    method: "POST",
    url: `/api/task-statuses/${sourceId}/merge-preview`,
    headers: { cookie: adminCookie },
    payload: { targetId },
  });

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
  adminId = admin.id;
  await prisma.user.create({
    data: {
      email: "member@test.local",
      name: "Member",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("member1234"),
    },
  });
  app = await buildApp();
  adminCookie = await loginCookie("admin@test.local", "admin1234");
  memberCookie = await loginCookie("member@test.local", "member1234");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("fusione di due stati", () => {
  it("sposta i task e lascia una riga di storico su ognuno", async () => {
    const from = await devStatus("In review 2");
    const to = await devStatus("Da testare 2");
    const a = await devTask("Primo", from.id);
    const b = await devTask("Secondo", from.id);

    const res = await merge(from.id, to.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ migrated: 2, trashed: 0 });

    for (const task of [a, b]) {
      const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(after.statusId).toBe(to.id);
      const log = await prisma.activityLog.findFirstOrThrow({
        where: { taskId: task.id, action: "status_merged" },
      });
      // Da dove viene e dove è andato: un cambio in massa senza traccia, letto
      // sei mesi dopo, è indistinguibile da un errore.
      expect(JSON.parse(log.payload!)).toEqual({ from: "In review 2", to: "Da testare 2" });
    }
  });

  it("lo stato di partenza viene eliminato: è rimasto vuoto", async () => {
    // Lasciarlo in elenco vorrebbe dire che il flusso che si stava mettendo in
    // ordine ha ancora la voce che si voleva togliere (18/08/2026).
    const from = await devStatus("Da rivedere");
    const to = await devStatus("Rivisto");
    const task = await devTask("Uno", from.id);

    const res = await merge(from.id, to.id);
    expect(res.json().deleted).toBe("Da rivedere");
    expect(await prisma.taskStatus.findUnique({ where: { id: from.id } })).toBeNull();
    // Il task non resta orfano: è passato allo stato di arrivo, non nel vuoto.
    const dopo = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(dopo.statusId).toBe(to.id);
  });

  it("porta con sé anche i task nel cestino, o lo stato non si svuota", async () => {
    const from = await devStatus("Sospeso");
    const to = await devStatus("In attesa di terzi (merge)");
    await devTask("Visibile", from.id);
    const cestinato = await devTask("Cestinato", from.id, { deletedAt: new Date() });

    const res = await merge(from.id, to.id);
    expect(res.json()).toMatchObject({ migrated: 1, trashed: 1 });
    const after = await prisma.task.findUniqueOrThrow({ where: { id: cestinato.id } });
    expect(after.statusId).toBe(to.id);

    // La prova del nove: la cancellazione in coda alla fusione riesce. Senza
    // portarsi dietro il cestino, lo stato non sarebbe vuoto e la chiave
    // esterna farebbe fallire tutta l'operazione per un task che nessuno vede.
    expect(await prisma.taskStatus.findUnique({ where: { id: from.id } })).toBeNull();
  });

  it("fondere in uno stato chiuso scrive la data di chiusura, e non la riscrive a chi ce l'ha", async () => {
    const from = await devStatus("Da chiudere");
    const to = await devStatus("Archiviato", true);
    const senzaData = await devTask("Senza data", from.id);
    const vecchio = new Date("2026-01-15T10:00:00Z");
    const conData = await prisma.task.create({
      data: {
        title: "Chiuso a gennaio",
        kind: TaskKind.PROJECT,
        statusId: from.id,
        creatorId: adminId,
        closedAt: vecchio,
      },
    });

    await merge(from.id, to.id);
    const a = await prisma.task.findUniqueOrThrow({ where: { id: senzaData.id } });
    const b = await prisma.task.findUniqueOrThrow({ where: { id: conData.id } });
    expect(a.closedAt).not.toBeNull();
    // Riscriverla a oggi avrebbe spostato il task nei conteggi di questa
    // settimana: una data di chiusura che c'era già è un fatto.
    expect(b.closedAt?.toISOString()).toBe(vecchio.toISOString());
  });

  it("fondere in uno stato aperto azzera la data di chiusura", async () => {
    const from = await devStatus("Finito", true);
    const to = await devStatus("Da rifare");
    const task = await prisma.task.create({
      data: {
        title: "Riaperto",
        kind: TaskKind.PROJECT,
        statusId: from.id,
        creatorId: adminId,
        closedAt: new Date(),
      },
    });

    await merge(from.id, to.id);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.closedAt).toBeNull();
  });

  it("i riferimenti seguono la fusione: ricorrenze e fasi pipeline", async () => {
    const from = await devStatus("Punto di partenza");
    const to = await devStatus("Nuovo punto di partenza");
    const template = await prisma.recurrenceTemplate.create({
      data: {
        title: "Canone trimestrale",
        rrule: "FREQ=MONTHLY;INTERVAL=3",
        dtstart: new Date("2026-01-01T00:00:00Z"),
        creatorId: adminId,
        initialStatusId: from.id,
      },
    });
    const stage = await prisma.dealStage.create({
      data: { name: "Vinta (merge)", color: "#22c55e", order: 90, wonTaskStatusId: from.id },
    });

    const res = await merge(from.id, to.id);
    expect(res.json()).toMatchObject({ recurrences: 1, dealStages: 1 });
    // Senza spostarli PRIMA, la cancellazione in coda alla fusione li
    // azzererebbe in silenzio (onDelete: SetNull): la ricorrenza nascerebbe
    // senza stato iniziale e l'offerta vinta non saprebbe più dove generare il
    // task. Che questo passi dopo la cancellazione è la prova che l'ordine è
    // quello giusto.
    expect(
      (await prisma.recurrenceTemplate.findUniqueOrThrow({ where: { id: template.id } }))
        .initialStatusId,
    ).toBe(to.id);
    expect(
      (await prisma.dealStage.findUniqueOrThrow({ where: { id: stage.id } })).wonTaskStatusId,
    ).toBe(to.id);
  });

  it("l'anteprima dice quanti record e le conseguenze, senza scrivere niente", async () => {
    const from = await devStatus("Anteprima");
    const to = await devStatus("Anteprima chiusa", true);
    await devTask("Uno", from.id);
    await devTask("Due", from.id);
    await devTask("Tre", from.id, { deletedAt: new Date() });

    const res = await previewMerge(from.id, to.id);
    expect(res.json()).toMatchObject({ tasks: 2, trashed: 1, closes: true, reopens: false });
    // Niente scritto: i task sono ancora dove erano.
    expect(await prisma.task.count({ where: { statusId: from.id } })).toBe(2);
  });

  it("i contrassegni passano allo stato di arrivo, e l'anteprima li dichiara", async () => {
    // Il contrassegno dice "in quest'area, lo stato che fa X": se quello stato
    // viene assorbito, il ruolo va con lui. Cancellarlo senza spostarlo
    // lascerebbe l'area senza, e nessuno se ne accorgerebbe fino al primo caso
    // vero (18/08/2026).
    const from = await devStatus("Con contrassegno");
    await prisma.taskStatus.update({
      where: { id: from.id },
      data: { isBillingMilestone: true },
    });
    const to = await devStatus("Senza contrassegno");

    const res = await previewMerge(from.id, to.id);
    expect(res.json().flags).toContain("Attività amministrativa");
    const done = await merge(from.id, to.id);
    expect(done.json().flagsMoved).toContain("Attività amministrativa");
    const after = await prisma.taskStatus.findUniqueOrThrow({ where: { id: to.id } });
    expect(after.isBillingMilestone).toBe(true);
  });

  it("un contrassegno che il destinatario ha già non si duplica né si annuncia", async () => {
    const from = await devStatus("Partenza contrassegnata");
    const to = await devStatus("Arrivo contrassegnato");
    await prisma.taskStatus.updateMany({
      where: { id: { in: [from.id, to.id] } },
      data: { isAssignedTarget: true },
    });

    const res = await previewMerge(from.id, to.id);
    expect(res.json().flags).not.toContain("Task assegnati");
    const done = await merge(from.id, to.id);
    expect(done.json().flagsMoved).toEqual([]);
    const after = await prisma.taskStatus.findUniqueOrThrow({ where: { id: to.id } });
    expect(after.isAssignedTarget).toBe(true);
  });

  it("non si fondono stati di aree diverse", async () => {
    const dev = await devStatus("Solo sviluppo");
    const admin = await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.ADMIN },
    });
    const res = await merge(dev.id, admin.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("stessa area");
  });

  it("non si fonde uno stato in sé stesso", async () => {
    const one = await devStatus("Uguale a sé");
    const res = await merge(one.id, one.id);
    expect(res.statusCode).toBe(400);
  });

  it("serve il permesso di configurare quell'area", async () => {
    const from = await devStatus("Protetto");
    const to = await devStatus("Protetto due");
    const task = await devTask("Non deve muoversi", from.id);

    const res = await merge(from.id, to.id, memberCookie);
    expect(res.statusCode).toBe(403);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.statusId).toBe(from.id);
  });
});
