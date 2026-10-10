// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ProjectRole, UserRole, VisibilityAccess, VisibilityScope } from "@kancrm/shared";

const { tempDir } = prepareTestDb("crossarea");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
const PW = "password-di-prova-1";

/** Amministrativa (vede lo scadenzario), commerciale (solo offerte), sviluppatore (niente). */
let francesca = { id: "" };
let dario = { id: "" };
let giacomo = { id: "" };
let elena = { id: "" };
let emanuele = { id: "" };
let osservatoriId = "";
let sviluppatoriId = "";
let commercialeId = "";
let adminStatusId = "";
let adminClosedStatusId = "";
let devStatusId = "";

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

beforeAll(async () => {
  const hash = await hashPassword(PW);
  francesca = await prisma.user.create({
    data: { email: "fc@x.local", name: "Francesca", role: UserRole.MEMBER, passwordHash: hash },
  });
  dario = await prisma.user.create({
    data: { email: "df@x.local", name: "Dario", role: UserRole.MEMBER, passwordHash: hash },
  });
  giacomo = await prisma.user.create({
    data: { email: "gv@x.local", name: "Giacomo", role: UserRole.MEMBER, passwordHash: hash },
  });

  // Gruppi con visibilità disgiunta: nessuno "sconfina" nell'area dell'altro.
  const amministrativo = await prisma.group.create({
    data: {
      name: "Amministrativo",
      managedArea: "ADMIN",
      members: { create: { userId: francesca.id } },
    },
  });
  const commerciale = await prisma.group.create({
    data: {
      name: "Commerciale",
      managedArea: "SALES",
      members: { create: { userId: dario.id } },
    },
  });
  commercialeId = commerciale.id;
  emanuele = await prisma.user.create({
    data: { email: "eb@x.local", name: "Emanuele", role: UserRole.MEMBER, passwordHash: hash },
  });
  // Giacomo è MANAGER degli Sviluppatori; Emanuele è un membro semplice.
  const sviluppatori = await prisma.group.create({
    data: {
      name: "Sviluppatori",
      managedArea: "DEV",
      members: {
        create: [{ userId: giacomo.id, isManager: true }, { userId: emanuele.id }],
      },
    },
  });
  sviluppatoriId = sviluppatori.id;
  await prisma.visibilitySetting.create({
    data: {
      scope: VisibilityScope.ADMIN_TASKS,
      groupId: amministrativo.id,
      access: VisibilityAccess.FULL,
    },
  });
  await prisma.visibilitySetting.create({
    data: { scope: VisibilityScope.DEALS, groupId: commerciale.id, access: VisibilityAccess.FULL },
  });
  // Gli sviluppatori governano i progetti: da qui il loro manager configura
  // stati e tipi dell'area sviluppo (e solo quelli).
  await prisma.visibilitySetting.create({
    data: {
      scope: VisibilityScope.PROJECTS,
      groupId: sviluppatori.id,
      access: VisibilityAccess.FULL,
    },
  });

  // Osservatrice: legge scadenzario e progetti, senza poterci scrivere.
  elena = await prisma.user.create({
    data: { email: "el@x.local", name: "Elena", role: UserRole.MEMBER, passwordHash: hash },
  });
  const osservatori = await prisma.group.create({
    data: { name: "Osservatori", members: { create: { userId: elena.id } } },
  });
  osservatoriId = osservatori.id;
  await prisma.visibilitySetting.createMany({
    data: [
      {
        scope: VisibilityScope.ADMIN_TASKS,
        groupId: osservatori.id,
        access: VisibilityAccess.READ,
      },
      { scope: VisibilityScope.PROJECTS, groupId: osservatori.id, access: VisibilityAccess.READ },
    ],
  });

  const open = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  adminStatusId = open.id;
  const closed = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: true },
    orderBy: { order: "asc" },
  });
  adminClosedStatusId = closed.id;
  const dev = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "DEV", isClosed: false },
    orderBy: { order: "asc" },
  });
  devStatusId = dev.id;

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

const get = async (email: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie: await cookie(email) } });
const patch = async (email: string, url: string, payload: object) =>
  app.inject({ method: "PATCH", url, headers: { cookie: await cookie(email) }, payload });

describe("un task assegnato si lavora anche fuori dalla propria area", () => {
  it("scadenzario: il commerciale riceve un task amministrativo, lo vede e ne cambia stato", async () => {
    // Francesca (amministrativa) assegna a Dario (commerciale, senza scope scadenzario)
    // e si tiene la supervisione.
    const task = await prisma.task.create({
      data: {
        title: "Registrare fattura fornitore",
        statusId: adminStatusId,
        creatorId: francesca.id,
        assigneeId: dario.id,
        supervisorId: francesca.id,
      },
    });

    // Dario lo vede pur non avendo accesso allo scadenzario…
    const seen = await get("df@x.local", `/api/tasks/${task.id}`);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().title).toBe("Registrare fattura fornitore");

    // …e lo lavora (cambio stato).
    const worked = await patch("df@x.local", `/api/tasks/${task.id}`, {
      statusId: adminClosedStatusId,
      confirmSequence: true,
      confirmSubtasks: true,
    });
    expect(worked.statusCode).toBe(200);
    expect(worked.json().status.isClosed).toBe(true);

    // Francesca, che lo supervisiona, riceve la notifica del cambio stato.
    const notifications = await prisma.notification.findMany({
      where: { userId: francesca.id },
    });
    expect(notifications.some((n) => n.type === "supervised_status_changed")).toBe(true);

    // Giacomo non è coinvolto e non ha lo scope: resta fuori.
    const denied = await get("gv@x.local", `/api/tasks/${task.id}`);
    expect(denied.statusCode).toBe(403);
  });

  it("scadenzario: il supervisore esterno all'area lo legge", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Task supervisionato da un commerciale",
        statusId: adminStatusId,
        creatorId: francesca.id,
        assigneeId: francesca.id,
        supervisorId: dario.id,
      },
    });
    expect((await get("df@x.local", `/api/tasks/${task.id}`)).statusCode).toBe(200);
  });

  it("progetti: l'assegnatario non membro del progetto vede e lavora il task", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Progetto riservato",
        members: { create: { userId: giacomo.id, role: ProjectRole.MANAGER } },
      },
    });
    const task = await prisma.task.create({
      data: {
        kind: "PROJECT",
        projectId: project.id,
        title: "Attività di sviluppo affidata a Dario",
        statusId: devStatusId,
        creatorId: giacomo.id,
        assigneeId: dario.id,
      },
    });

    // Dario non è membro del progetto, ma il task è suo: lo vede e lo modifica.
    expect((await get("df@x.local", `/api/tasks/${task.id}`)).statusCode).toBe(200);
    const edited = await patch("df@x.local", `/api/tasks/${task.id}`, { title: "Rinominato" });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().title).toBe("Rinominato");

    // Francesca, estranea al progetto e al task, non lo vede (404: non si rivela).
    expect((await get("fc@x.local", `/api/tasks/${task.id}`)).statusCode).toBe(404);
  });

  it("offerte: l'assegnatario senza accesso alle offerte lavora il task collegato", async () => {
    const stage = await prisma.dealStage.create({
      data: { name: "Trattativa cross-area", color: "#f59e0b", order: 0 },
    });
    const deal = await prisma.task.create({
      data: {
        kind: "DEAL",
        title: "Offerta con attività affidata",
        statusId: adminStatusId,
        creatorId: dario.id,
        dealStageId: stage.id,
        assigneeId: francesca.id, // intestata all'amministrativa, che non vede le offerte
      },
    });

    expect((await get("fc@x.local", `/api/tasks/${deal.id}`)).statusCode).toBe(200);
    const edited = await patch("fc@x.local", `/api/tasks/${deal.id}`, { title: "Offerta seguita" });
    expect(edited.statusCode).toBe(200);

    // Giacomo non c'entra nulla e non ha accesso alle offerte.
    expect((await get("gv@x.local", `/api/tasks/${deal.id}`)).statusCode).toBe(403);
  });
});

describe("livelli di accesso per area (Niente / Sola lettura / Completo)", () => {
  it("sola lettura sullo scadenzario: vede i task altrui ma non li modifica", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Task di sola consultazione",
        statusId: adminStatusId,
        creatorId: francesca.id,
        assigneeId: francesca.id,
      },
    });
    expect((await get("el@x.local", `/api/tasks/${task.id}`)).statusCode).toBe(200);
    const blocked = await patch("el@x.local", `/api/tasks/${task.id}`, { title: "Non dovrei" });
    expect(blocked.statusCode).toBe(403);
  });

  it("sola lettura sui progetti: li vede tutti (anche senza membership) ma non ne modifica i task", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Progetto osservato",
        members: { create: { userId: giacomo.id, role: ProjectRole.MANAGER } },
      },
    });
    const task = await prisma.task.create({
      data: {
        kind: "PROJECT",
        projectId: project.id,
        title: "Attività osservata",
        statusId: devStatusId,
        creatorId: giacomo.id,
        assigneeId: giacomo.id,
      },
    });

    // In elenco e in dettaglio, pur non essendo membro.
    const list = await get("el@x.local", "/api/projects");
    expect(list.json().some((p: { id: string }) => p.id === project.id)).toBe(true);
    expect((await get("el@x.local", `/api/projects/${project.id}`)).statusCode).toBe(200);
    expect((await get("el@x.local", `/api/tasks/${task.id}`)).statusCode).toBe(200);

    // Ma non ci scrive.
    const blocked = await patch("el@x.local", `/api/tasks/${task.id}`, { title: "Non dovrei" });
    expect(blocked.statusCode).toBe(403);

    // Chi non ha né scope né membership resta fuori (404: non si rivela il progetto).
    expect((await get("fc@x.local", `/api/projects/${project.id}`)).statusCode).toBe(404);

    // Alzando il livello a Completo, lo stesso task diventa modificabile.
    await prisma.visibilitySetting.update({
      where: { scope_groupId: { scope: VisibilityScope.PROJECTS, groupId: osservatoriId } },
      data: { access: VisibilityAccess.FULL },
    });
    const allowed = await patch("el@x.local", `/api/tasks/${task.id}`, { title: "Ora posso" });
    expect(allowed.statusCode).toBe(200);
    // Ripristina il livello per non influenzare altri test.
    await prisma.visibilitySetting.update({
      where: { scope_groupId: { scope: VisibilityScope.PROJECTS, groupId: osservatoriId } },
      data: { access: VisibilityAccess.READ },
    });
  });
});

describe("manager di gruppo", () => {
  const put = async (email: string, url: string, payload: object) =>
    app.inject({ method: "PUT", url, headers: { cookie: await cookie(email) }, payload });
  const post = async (email: string, url: string, payload: object) =>
    app.inject({ method: "POST", url, headers: { cookie: await cookie(email) }, payload });

  it("legge i task dell'AREA che governa, di chiunque siano, senza poterli modificare", async () => {
    // Regola scelta l'11/08/2026: chi guida un'area segue il lavoro di
    // quell'area — non "le persone del suo gruppo", che con qualcuno iscritto
    // ovunque avrebbe significato vedere tutto. L'area è quella dello stato.
    const devStatus = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: false },
      orderBy: { order: "asc" },
    });
    const tecnico = await prisma.task.create({
      data: {
        title: "Lavoro tecnico di Francesca",
        statusId: devStatus.id,
        creatorId: francesca.id,
        assigneeId: francesca.id,
      },
    });
    // Giacomo governa lo sviluppo: lo legge anche se non è suo né del suo gruppo.
    expect((await get("gv@x.local", `/api/tasks/${tecnico.id}`)).statusCode).toBe(200);
    // Lettura, non modifica.
    const blocked = await patch("gv@x.local", `/api/tasks/${tecnico.id}`, { title: "Non posso" });
    expect(blocked.statusCode).toBe(403);

    // Fuori dalla sua area invece no: un amministrativo di Emanuele, che pure è
    // nel suo gruppo, non lo riguarda.
    const amministrativo = await prisma.task.create({
      data: {
        title: "Attività di Emanuele",
        statusId: adminStatusId,
        creatorId: emanuele.id,
        assigneeId: emanuele.id,
      },
    });
    expect((await get("gv@x.local", `/api/tasks/${amministrativo.id}`)).statusCode).toBe(403);
    // E un non-manager estraneo resta fuori da entrambi.
    expect((await get("df@x.local", `/api/tasks/${amministrativo.id}`)).statusCode).toBe(403);
  });

  it("vede e gestisce i membri del SUO gruppo; non i gruppi altrui né i manager", async () => {
    // L'elenco gruppi del manager contiene solo il suo.
    const list = await get("gv@x.local", "/api/groups");
    expect(list.statusCode).toBe(200);
    expect(list.json().map((g: { name: string }) => g.name)).toEqual(["Sviluppatori"]);

    // Aggiunge Elena al suo gruppo (i flag manager restano invariati).
    const updated = await put("gv@x.local", `/api/groups/${sviluppatoriId}/members`, {
      userIds: [giacomo.id, emanuele.id, elena.id],
    });
    expect(updated.statusCode).toBe(200);
    const members = updated.json().members as Array<{ id: string; isManager: boolean }>;
    expect(members.find((m) => m.id === giacomo.id)?.isManager).toBe(true);
    expect(members.find((m) => m.id === elena.id)?.isManager).toBe(false);

    // Non può auto-rimuoversi dal ruolo di manager né toccare un gruppo altrui.
    const selfRemove = await put("gv@x.local", `/api/groups/${sviluppatoriId}/members`, {
      userIds: [emanuele.id, elena.id],
    });
    expect(selfRemove.statusCode).toBe(403);
    const foreign = await put("gv@x.local", `/api/groups/${commercialeId}/members`, {
      userIds: [giacomo.id],
    });
    expect(foreign.statusCode).toBe(403);
    // managerIds è riservato all'admin: da manager viene ignorato.
    const sneaky = await put("gv@x.local", `/api/groups/${sviluppatoriId}/members`, {
      userIds: [giacomo.id, emanuele.id, elena.id],
      managerIds: [giacomo.id, emanuele.id],
    });
    expect(sneaky.statusCode).toBe(200);
    const after = sneaky.json().members as Array<{ id: string; isManager: boolean }>;
    expect(after.find((m) => m.id === emanuele.id)?.isManager).toBe(false);
  });

  it("configura stati e tipi di attività; un non-manager no", async () => {
    // Stato: creazione consentita al manager…
    const created = await post("gv@x.local", "/api/task-statuses", {
      name: "In verifica QA",
      category: "DEV",
      color: "#123456",
      isClosed: false,
      isWonTarget: false,
      isAssignedTarget: false,
      stopsRecurrence: false,
    });
    expect(created.statusCode).toBe(201);
    // …e negata a un membro semplice.
    const denied = await post("eb@x.local", "/api/task-statuses", {
      name: "Non posso",
      category: "DEV",
      color: "#123456",
      isClosed: false,
      isWonTarget: false,
      isAssignedTarget: false,
      stopsRecurrence: false,
    });
    expect(denied.statusCode).toBe(403);

    // Tipo di attività: crea, rinomina, elimina (mai usato → sparisce davvero).
    const type = await post("gv@x.local", "/api/activity-types", {
      name: "Collaudo",
      category: "DEV",
      color: "#22c55e",
      isMeeting: false,
    });
    expect(type.statusCode).toBe(201);
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/activity-types/${type.json().id}`,
      headers: { cookie: await cookie("gv@x.local") },
      payload: { name: "Collaudo interno" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("Collaudo interno");
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/activity-types/${type.json().id}`,
      headers: { cookie: await cookie("gv@x.local") },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await prisma.activityType.findUnique({ where: { id: type.json().id } })).toBeNull();

    // Il flag arriva anche al client: Giacomo è manager, Emanuele no.
    const me = await get("gv@x.local", "/api/auth/me");
    expect(me.json().isGroupManager).toBe(true);
    const meMember = await get("eb@x.local", "/api/auth/me");
    expect(meMember.json().isGroupManager).toBe(false);
  });
});

describe("chi vede cosa (/api/users/:id/access)", () => {
  it("l'admin legge l'accesso effettivo di un utente; un membro no", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "boss@x.local",
        name: "Boss",
        role: UserRole.ADMIN,
        adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
        passwordHash: await (await import("../src/modules/auth/password")).hashPassword(PW),
      },
    });
    void admin;

    const res = await get("boss@x.local", `/api/users/${dario.id}/access`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scopes.DEALS).toBe("FULL"); // gruppo Commerciale
    expect(body.scopes.PROJECTS).toBeNull();
    expect(body.isAdmin).toBe(false);

    // Giacomo è manager degli Sviluppatori: compare nell'elenco.
    const giac = await get("boss@x.local", `/api/users/${giacomo.id}/access`);
    expect(giac.json().managerOf).toContain("Sviluppatori");

    // Non-admin: 403.
    const denied = await get("df@x.local", `/api/users/${dario.id}/access`);
    expect(denied.statusCode).toBe(403);
  });
});

describe("ricorrenze: si vedono solo quelle che ti riguardano", () => {
  it("un membro senza accesso allo scadenzario non vede le ricorrenze altrui", async () => {
    // Il caso segnalato: un utente di sviluppo vedeva tutte le scadenze
    // ricorrenti dell'amministrazione, e i pulsanti per eliminarle.
    const mine = await prisma.recurrenceTemplate.create({
      data: {
        title: "Ricorrenza dello sviluppatore",
        rrule: "FREQ=MONTHLY",
        dtstart: new Date("2026-09-01T00:00:00.000Z"),
        creatorId: giacomo.id,
        assigneeId: giacomo.id,
      },
    });
    const admins = await prisma.recurrenceTemplate.create({
      data: {
        title: "Liquidazione IVA (amministrazione)",
        rrule: "FREQ=MONTHLY",
        dtstart: new Date("2026-09-16T00:00:00.000Z"),
        creatorId: francesca.id,
        assigneeId: francesca.id,
      },
    });

    // Giacomo (nessuno scope sullo scadenzario): vede solo la propria.
    const asDev = await get("gv@x.local", "/api/recurrence-templates");
    expect(asDev.statusCode).toBe(200);
    const devTitles = asDev.json().map((t: { title: string }) => t.title);
    expect(devTitles).toContain("Ricorrenza dello sviluppatore");
    expect(devTitles).not.toContain("Liquidazione IVA (amministrazione)");

    // Francesca (scope ADMIN_TASKS): vede tutto lo scadenzario ricorrente.
    const asAdminArea = await get("fc@x.local", "/api/recurrence-templates");
    const adminTitles = asAdminArea.json().map((t: { title: string }) => t.title);
    expect(adminTitles).toContain("Liquidazione IVA (amministrazione)");
    expect(adminTitles).toContain("Ricorrenza dello sviluppatore");

    // canManage: la UI mostra modifica/elimina solo a chi l'ha creata.
    const own = asDev.json().find((t: { id: string }) => t.id === mine.id);
    expect(own.canManage).toBe(true);
    const others = asAdminArea.json().find((t: { id: string }) => t.id === mine.id);
    expect(others.canManage).toBe(false); // Francesca la vede ma non la gestisce

    // Non può nemmeno crearne una intestata a un amministrativo: senza accesso
    // allo scadenzario la ricorrenza è personale.
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: await cookie("gv@x.local") },
      payload: {
        title: "Scadenza per Francesca",
        rrule: "FREQ=MONTHLY",
        dtstart: "2026-10-01",
        assigneeId: francesca.id,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().assignee).toBeNull(); // l'intestazione ad altri è caduta

    // E il server rifiuta comunque la modifica di una ricorrenza altrui.
    const denied = await app.inject({
      method: "PATCH",
      url: `/api/recurrence-templates/${admins.id}`,
      headers: { cookie: await cookie("gv@x.local") },
      payload: { title: "Non dovrei" },
    });
    expect(denied.statusCode).toBe(403);
  });
});

/**
 * I permessi che il server manda al client sono gli stessi con cui accetta o
 * rifiuta le richieste: è la garanzia che un comando si veda se e solo se
 * funziona. Prima il client li ricalcolava per conto suo e il menu offriva
 * "Elimina" anche a chi avrebbe ricevuto un rifiuto.
 */
describe("canEdit / canDelete: quello che il client mostra è quello che il server accetta", () => {
  it("chi ha il task in carico lo modifica ma non lo elimina: non è suo", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Assegnato a Dario",
        statusId: adminStatusId,
        creatorId: francesca.id,
        assigneeId: dario.id,
      },
    });
    const seen = await get("df@x.local", `/api/tasks/${task.id}`);
    expect(seen.json().canEdit).toBe(true);
    expect(seen.json().canDelete).toBe(false);

    // E il server la pensa allo stesso modo.
    const denied = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: await cookie("df@x.local") },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("chi lo ha creato può eliminarlo", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Creato da Francesca",
        statusId: adminStatusId,
        creatorId: francesca.id,
        assigneeId: dario.id,
      },
    });
    const seen = await get("fc@x.local", `/api/tasks/${task.id}`);
    expect(seen.json().canDelete).toBe(true);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: await cookie("fc@x.local") },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("chi legge e basta non può né modificare né eliminare", async () => {
    // Elena ha lo scadenzario in sola lettura.
    const task = await prisma.task.create({
      data: {
        title: "Solo consultabile",
        statusId: adminStatusId,
        creatorId: francesca.id,
        assigneeId: francesca.id,
      },
    });
    const seen = await get("el@x.local", `/api/tasks/${task.id}`);
    expect(seen.json().canEdit).toBe(false);
    expect(seen.json().canDelete).toBe(false);
  });
});

describe("il manager configura solo l'area del proprio gruppo", () => {
  it("stati e tipi: Giacomo (manager Sviluppatori) tocca lo sviluppo, non l'amministrazione", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie: await cookie("gv@x.local") },
      payload: { name: "In collaudo", category: "DEV", color: "#2563eb" },
    });
    expect(created.statusCode).toBe(201);

    // Ma non può creare uno stato amministrativo: non è la sua area.
    const denied = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie: await cookie("gv@x.local") },
      payload: { name: "Da protocollare", category: "ADMIN", color: "#f59e0b" },
    });
    expect(denied.statusCode).toBe(403);

    // Nemmeno modificare uno stato amministrativo esistente.
    const adminStatus = await prisma.taskStatus.findFirstOrThrow({ where: { category: "ADMIN" } });
    const deniedPatch = await patch("gv@x.local", `/api/task-statuses/${adminStatus.id}`, {
      name: "Rinominato da un estraneo",
    });
    expect(deniedPatch.statusCode).toBe(403);

    // Stessa regola per i tipi di attività.
    const type = await app.inject({
      method: "POST",
      url: "/api/activity-types",
      headers: { cookie: await cookie("gv@x.local") },
      payload: { name: "Refactoring", category: "DEV", color: "#22c55e", isMeeting: false },
    });
    expect(type.statusCode).toBe(201);
    const typeDenied = await app.inject({
      method: "POST",
      url: "/api/activity-types",
      headers: { cookie: await cookie("gv@x.local") },
      payload: {
        name: "Adempimento fiscale",
        category: "ADMIN",
        color: "#f59e0b",
        isMeeting: false,
      },
    });
    expect(typeDenied.statusCode).toBe(403);
  });

  it("il profilo dice quali aree si possono configurare", async () => {
    const asDev = await get("gv@x.local", "/api/auth/me");
    expect(asDev.json().manageableCategories).toEqual(["DEV"]);

    // Emanuele è membro degli Sviluppatori ma non manager: nessuna area.
    const asMember = await get("eb@x.local", "/api/auth/me");
    expect(asMember.json().isGroupManager).toBe(false);
    expect(asMember.json().manageableCategories).toEqual([]);
  });

  it("manager di progetto non è manager di gruppo: non configura l'area sviluppo", async () => {
    // Due cose diverse con lo stesso nome: il manager di un PROGETTO ne governa
    // membri e task; le aree di lavoro (stati e tipi) le governa solo il manager
    // di un GRUPPO. Emanuele qui è manager del progetto e sta anche nel gruppo che
    // ha i progetti in accesso completo: se le due nozioni si confondessero,
    // erediterebbe la configurazione dell'area sviluppo.
    await prisma.project.create({
      data: {
        name: "Progetto guidato da Emanuele",
        members: { create: { userId: emanuele.id, role: ProjectRole.MANAGER } },
      },
    });

    const me = await get("eb@x.local", "/api/auth/me");
    expect(me.json().isGroupManager).toBe(false);
    expect(me.json().manageableCategories).toEqual([]);

    const denied = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie: await cookie("eb@x.local") },
      payload: { name: "In collaudo dal PM", category: "DEV", color: "#2563eb" },
    });
    expect(denied.statusCode).toBe(403);

    const typeDenied = await app.inject({
      method: "POST",
      url: "/api/activity-types",
      headers: { cookie: await cookie("eb@x.local") },
      payload: { name: "Analisi dal PM", category: "DEV", color: "#22c55e", isMeeting: false },
    });
    expect(typeDenied.statusCode).toBe(403);
  });
});
