import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ProjectRole, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("userdel");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const { ARCHIVE_USER_EMAIL } = await import("../src/modules/users/deletion");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie = "";
let statusId = "";

/** Utente + task + commento + ore: il minimo per rendere l'utente "non eliminabile". */
async function createUserWithData(email: string, name: string) {
  const user = await prisma.user.create({
    data: { email, name, role: UserRole.MEMBER, passwordHash: await hashPassword("password-1") },
  });
  const task = await prisma.task.create({
    data: { title: `Task di ${name}`, statusId, creatorId: user.id, assigneeId: user.id },
  });
  await prisma.comment.create({
    data: { taskId: task.id, authorId: user.id, body: "una nota" },
  });
  await prisma.timeEntry.create({
    data: {
      userId: user.id,
      taskId: task.id,
      date: new Date("2026-07-01T00:00:00.000Z"),
      hours: 4,
      note: "analisi",
    },
  });
  return { user, task };
}

beforeAll(async () => {
  const passwordHash = await hashPassword("password-1");
  await prisma.user.create({
    data: { email: "admin@test.local", name: "Admin", role: UserRole.ADMIN, adminUntil: new Date("2099-01-01"), passwordHash },
  });
  await prisma.user.create({
    data: { email: "erede@test.local", name: "Erede", role: UserRole.MEMBER, passwordHash },
  });
  await prisma.user.create({
    data: { email: "cliente@test.local", name: "Cliente", role: UserRole.PORTAL, passwordHash },
  });
  const openStatus = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  statusId = openStatus.id;

  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "admin@test.local", password: "password-1" },
  });
  adminCookie = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("eliminazione utenti", () => {
  it("elimina senza domande un utente senza dati collegati", async () => {
    const user = await prisma.user.create({
      data: { email: "vuoto@test.local", name: "Vuoto", role: UserRole.MEMBER },
    });

    const impact = await app.inject({
      method: "GET",
      url: `/api/users/${user.id}/deletion-impact`,
      headers: { cookie: adminCookie },
    });
    expect(impact.json().hasData).toBe(false);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/users/${user.id}`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it("rifiuta l'eliminazione senza destinatario se l'utente ha dati", async () => {
    const { user } = await createUserWithData("conDati@test.local", "Con Dati");

    const impact = await app.inject({
      method: "GET",
      url: `/api/users/${user.id}/deletion-impact`,
      headers: { cookie: adminCookie },
    });
    expect(impact.json()).toMatchObject({
      hasData: true,
      counts: { tasks: 1, comments: 1, hours: 4 },
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/users/${user.id}`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("TRANSFER_REQUIRED");
    // L'utente è ancora lì: niente di distruttivo è successo.
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it("trasferisce i dati al destinatario e intesta le ore all'Archivio", async () => {
    const { user, task } = await createUserWithData("uscente@test.local", "Mario Uscente");
    const heir = await prisma.user.findUniqueOrThrow({ where: { email: "erede@test.local" } });
    const project = await prisma.project.create({
      data: {
        name: "Progetto con un solo manager",
        members: { create: { userId: user.id, role: ProjectRole.MANAGER } },
      },
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/users/${user.id}?transferTo=${heir.id}`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();

    // Task, commenti e storico passano all'erede.
    const movedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(movedTask.creatorId).toBe(heir.id);
    expect(movedTask.assigneeId).toBe(heir.id);
    const comment = await prisma.comment.findFirstOrThrow({ where: { taskId: task.id } });
    expect(comment.authorId).toBe(heir.id);

    // Il progetto non resta senza manager.
    const membership = await prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: project.id, userId: heir.id } },
    });
    expect(membership.role).toBe(ProjectRole.MANAGER);

    // Le ore restano nei totali, ma intestate all'Archivio e con il nome nella nota.
    const archive = await prisma.user.findUniqueOrThrow({
      where: { email: ARCHIVE_USER_EMAIL },
    });
    expect(archive.isSystem).toBe(true);
    expect(archive.isActive).toBe(false);
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { userId: archive.id } });
    expect(entry.hours).toBe(4);
    expect(entry.note).toBe("analisi — ore di Mario Uscente");
    // Nessuna ora è finita nel timesheet dell'erede.
    expect(await prisma.timeEntry.count({ where: { userId: heir.id } })).toBe(0);
  });

  it("somma le ore quando l'Archivio ha già una registrazione per lo stesso task e giorno", async () => {
    const heir = await prisma.user.findUniqueOrThrow({ where: { email: "erede@test.local" } });
    const archive = await prisma.user.findUniqueOrThrow({ where: { email: ARCHIVE_USER_EMAIL } });
    const existing = await prisma.timeEntry.findFirstOrThrow({ where: { userId: archive.id } });

    const second = await prisma.user.create({
      data: { email: "secondo@test.local", name: "Luigi Secondo", role: UserRole.MEMBER },
    });
    await prisma.timeEntry.create({
      data: { userId: second.id, taskId: existing.taskId, date: existing.date, hours: 2 },
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/users/${second.id}?transferTo=${heir.id}`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(204);

    const merged = await prisma.timeEntry.findUniqueOrThrow({
      where: {
        userId_taskId_date: {
          userId: archive.id,
          taskId: existing.taskId,
          date: existing.date,
        },
      },
    });
    expect(merged.hours).toBe(6); // 4 + 2: nessuna ora persa
    expect(merged.note).toContain("Mario Uscente");
    expect(merged.note).toContain("Luigi Secondo");
  });

  it("rifiuta il proprio account, l'utente di sistema e un destinatario del portale", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const archive = await prisma.user.findUniqueOrThrow({ where: { email: ARCHIVE_USER_EMAIL } });
    const portal = await prisma.user.findUniqueOrThrow({ where: { email: "cliente@test.local" } });
    const { user } = await createUserWithData("altro@test.local", "Altro");

    const self = await app.inject({
      method: "DELETE",
      url: `/api/users/${admin.id}`,
      headers: { cookie: adminCookie },
    });
    expect(self.statusCode).toBe(400);

    const system = await app.inject({
      method: "DELETE",
      url: `/api/users/${archive.id}`,
      headers: { cookie: adminCookie },
    });
    expect(system.statusCode).toBe(400);

    const toPortal = await app.inject({
      method: "DELETE",
      url: `/api/users/${user.id}?transferTo=${portal.id}`,
      headers: { cookie: adminCookie },
    });
    expect(toPortal.statusCode).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it("è riservata agli amministratori", async () => {
    const heir = await prisma.user.findUniqueOrThrow({ where: { email: "erede@test.local" } });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "erede@test.local", password: "password-1" },
    });
    const cookie = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;

    const response = await app.inject({
      method: "DELETE",
      url: `/api/users/${heir.id}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
  });
});
