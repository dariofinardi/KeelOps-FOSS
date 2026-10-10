// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { TaskKind, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("m7");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;
let memberCookie: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

beforeAll(async () => {
  const everyone = await prisma.group.create({ data: { name: "Tutti" } });
  await prisma.visibilitySetting.createMany({
    data: [
      { scope: "ADMIN_TASKS", groupId: everyone.id },
      { scope: "DEALS", groupId: everyone.id },
    ],
  });
  const admin = await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
      passwordHash: await hashPassword("admin1234"),
    },
  });
  await prisma.user.create({
    data: {
      email: "member@test.local",
      name: "Member",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("member1234"),
      groups: { create: { groupId: everyone.id } },
    },
  });

  // Stato aperto della categoria amministrativa (creato dalle migrazioni).
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  const stage = await prisma.dealStage.create({
    data: { name: "Trattativa", color: "#f59e0b", order: 0 },
  });

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  await prisma.task.create({
    data: {
      kind: "ADMIN",
      title: "Scaduto ieri",
      statusId: status.id,
      creatorId: admin.id,
      assigneeId: admin.id,
      dueDate: yesterday,
    },
  });
  await prisma.task.create({
    data: {
      kind: "ADMIN",
      title: "Scade oggi con parola rarissima: quetzalcoatl",
      description: "descrizione con termine univoco: xilografia",
      statusId: status.id,
      creatorId: admin.id,
      assigneeId: admin.id,
      dueDate: today,
    },
  });
  await prisma.task.create({
    data: {
      kind: "ADMIN",
      title: "Task libero da prendere",
      statusId: status.id,
      creatorId: admin.id,
      assigneeId: null,
    },
  });
  const company = await prisma.company.create({ data: { name: "Quetzalcoatl SpA" } });
  const contact = await prisma.contact.create({
    data: { firstName: "Quinto", lastName: "Quetzal", companyId: company.id },
  });
  await prisma.task.create({
    data: {
      kind: "DEAL",
      title: "Offerta quetzalcoatl SpA",
      statusId: status.id,
      creatorId: admin.id,
      dealStageId: stage.id,
      dealValue: 9000,
      companyId: company.id,
      contactId: contact.id,
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

describe("dashboard", () => {
  it("returns overdue, due-today, status counts and open deals", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.overdue.mine.map((t: { title: string }) => t.title)).toContain("Scaduto ieri");
    expect(data.dueToday.mine).toHaveLength(1);
    expect(data.myOpenTaskCount).toBe(2);
    expect(data.myTasksByStatus[0].count).toBe(2);
    // Id e tipo accompagnano il conteggio: la dashboard ci apre l'elenco filtrato.
    expect(data.myTasksByStatus[0].id).toBeTruthy();
    expect(data.myTasksByStatus[0].kind).toBe("ADMIN");
    /**
     * Le offerte arrivano divise per perimetro — le mie e quelle degli altri —
     * con i due totali: le pastiglie del riepilogo mostrano i numeri di
     * entrambe, «si guarda una lista alla volta e il numero dice cosa c'è
     * nell'altra» (04/09/2026).
     */
    const offerte = data.openDeals as {
      mine: Array<{
        title: string;
        company: { name: string } | null;
        contact: { name: string } | null;
      }>;
      others: Array<{
        title: string;
        company: { name: string } | null;
        contact: { name: string } | null;
      }>;
      mineTotal: number;
      othersTotal: number;
    };
    const tutte = [...offerte.mine, ...offerte.others];
    expect(tutte.map((d) => d.title)).toContain("Offerta quetzalcoatl SpA");
    // Sotto il titolo si leggono azienda e interlocutore (05/09/2026).
    const quetzal = tutte.find((d) => d.title === "Offerta quetzalcoatl SpA")!;
    expect(quetzal.company?.name).toBe("Quetzalcoatl SpA");
    expect(quetzal.contact?.name).toBe("Quinto Quetzal");
    // I totali contano tutto, le liste si fermano alle prime cinque.
    expect(offerte.mineTotal).toBeGreaterThanOrEqual(offerte.mine.length);
    expect(offerte.othersTotal).toBeGreaterThanOrEqual(offerte.others.length);
    // E nessuna offerta sta in tutte e due: sono perimetri, non due viste.
    const idMie = new Set(offerte.mine.map((d) => (d as { id?: string }).id));
    expect(offerte.others.some((d) => idMie.has((d as { id?: string }).id))).toBe(false);
    // Nuovi campi: task non assegnati da prendere e ticket in attesa.
    expect(data.unassignedTasks.map((t: { title: string }) => t.title)).toContain(
      "Task libero da prendere",
    );
    expect(Array.isArray(data.openTickets)).toBe(true);
  });

  // Il badge è un link a un elenco: il numero deve valere per QUELL'elenco, non
  // essere una somma di moduli diversi (prima "Assegnato 3" ne mostrava 2).
  it("conta separatamente per modulo e non include i subtask dello scadenzario", async () => {
    const status = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
      orderBy: { order: "asc" },
    });
    const stage = await prisma.dealStage.findFirstOrThrow({ where: { name: "Trattativa" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.local" } });

    const countFor = async (kind: string) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/dashboard",
        headers: { cookie: adminCookie },
      });
      return (
        res
          .json()
          .myTasksByStatus.find(
            (s: { id: string; kind: string }) => s.id === status.id && s.kind === kind,
          )?.count ?? 0
      );
    };
    const adminBefore = await countFor("ADMIN");

    // Un'offerta con lo STESSO stato: prima finiva nel conteggio dello scadenzario.
    await prisma.task.create({
      data: {
        kind: "DEAL",
        title: "Offerta con stato amministrativo",
        statusId: status.id,
        creatorId: admin.id,
        assigneeId: admin.id,
        dealStageId: stage.id,
      },
    });
    // Un subtask: lo scadenzario elenca solo i task di primo livello.
    const parent = await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Padre con subtask",
        statusId: status.id,
        creatorId: admin.id,
        assigneeId: admin.id,
      },
    });
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Subtask che non compare in elenco",
        statusId: status.id,
        creatorId: admin.id,
        assigneeId: admin.id,
        parentTaskId: parent.id,
      },
    });

    // Il badge dello scadenzario cresce solo del padre: non del subtask né dell'offerta.
    expect(await countFor("ADMIN")).toBe(adminBefore + 1);
    // L'offerta ha un badge proprio, che porta al suo modulo.
    expect(await countFor("DEAL")).toBe(1);

    // Controprova: il badge coincide con quanto mostra l'elenco dello scadenzario.
    const list = await app.inject({
      method: "GET",
      url: `/api/tasks?statusId=${status.id}&assigneeId=${admin.id}&pageSize=1000`,
      headers: { cookie: adminCookie },
    });
    expect(list.json().total).toBe(await countFor("ADMIN"));
  });

  it("le scadenze distinguono i miei task da quelli che supervisiono", async () => {
    const member = await prisma.user.findUniqueOrThrow({ where: { email: "member@test.local" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const status = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
    });
    const overdue = new Date();
    overdue.setUTCDate(overdue.getUTCDate() - 2);
    overdue.setUTCHours(0, 0, 0, 0);
    // Lo esegue il member, l'admin ne risponde: per l'admin sta tra i
    // Supervisionati, non tra i suoi.
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Supervisionato in ritardo",
        statusId: status.id,
        creatorId: admin.id,
        assigneeId: member.id,
        supervisorId: admin.id,
        dueDate: overdue,
      },
    });
    // Fra tre giorni: finisce in "Prossimi giorni" (da dopodomani a +5).
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 3);
    soon.setUTCHours(0, 0, 0, 0);
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Fra tre giorni",
        statusId: status.id,
        creatorId: admin.id,
        assigneeId: admin.id,
        dueDate: soon,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie: adminCookie },
    });
    const data = res.json();
    const titoli = (list: Array<{ title: string }>) => list.map((t) => t.title);
    expect(titoli(data.overdue.supervised)).toContain("Supervisionato in ritardo");
    expect(titoli(data.overdue.mine)).not.toContain("Supervisionato in ritardo");
    expect(titoli(data.nextDays.mine)).toContain("Fra tre giorni");

    // Senza scadenza: prima non compariva in nessun riquadro, e chi lo
    // supervisiona non lo trovava (il caso "Consegna beta").
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Consegna senza data",
        statusId: status.id,
        creatorId: admin.id,
        assigneeId: member.id,
        supervisorId: admin.id,
      },
    });
    const conSenzaData = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie: adminCookie },
    });
    expect(titoli(conSenzaData.json().noDueDate.supervised)).toContain("Consegna senza data");

    // Per chi lo esegue è un task SUO: niente doppio conteggio.
    const perMember = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { cookie: memberCookie },
    });
    expect(titoli(perMember.json().overdue.mine)).toContain("Supervisionato in ritardo");
    expect(titoli(perMember.json().overdue.supervised)).not.toContain("Supervisionato in ritardo");
  });
});

describe("ricerca globale", () => {
  it("finds tasks by title and description, contacts and companies", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/search?q=quetzal",
      headers: { cookie: adminCookie },
    });
    const types = response.json().map((r: { type: string }) => r.type);
    expect(types).toContain("task");
    expect(types).toContain("deal");
    expect(types).toContain("contact");
    expect(types).toContain("company");

    const byDescription = await app.inject({
      method: "GET",
      url: "/api/search?q=xilografia",
      headers: { cookie: adminCookie },
    });
    expect(byDescription.json()).toHaveLength(1);
  });

  it("requires at least 2 characters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/search?q=a",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("export CSV", () => {
  it("exports tasks and deals as CSV", async () => {
    const tasks = await app.inject({
      method: "GET",
      url: "/api/tasks/export",
      headers: { cookie: adminCookie },
    });
    expect(tasks.statusCode).toBe(200);
    expect(tasks.headers["content-type"]).toContain("text/csv");
    expect(tasks.body).toContain("Titolo;Stato");
    expect(tasks.body).toContain('"Scaduto ieri"');

    const deals = await app.inject({
      method: "GET",
      url: "/api/deals/export",
      headers: { cookie: adminCookie },
    });
    expect(deals.body).toContain("Offerta;Fase");
    expect(deals.body).toContain('"Offerta quetzalcoatl SpA"');
  });
});

describe("admin sistema e backup", () => {
  it("system info is admin-only", async () => {
    const denied = await app.inject({
      method: "GET",
      url: "/api/admin/system",
      headers: { cookie: memberCookie },
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/admin/system",
      headers: { cookie: adminCookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().counts.users).toBe(2);

    // Con due motori possibili, la pagina deve dire su quale sta guardando:
    // un conteggio giusto letto dall'ambiente sbagliato inganna più che aiutare.
    const database = allowed.json().database as {
      motore: string;
      etichetta: string;
      versione: string | null;
      dove: string;
      dimensioneBytes: number;
    };
    expect(database.motore).toBe("sqlite");
    expect(database.etichetta).toBe("SQLite");
    expect(database.versione).toMatch(/^\d+\.\d+/);
    expect(database.dimensioneBytes).toBeGreaterThan(0);
    // Il «dove» finisce sotto gli occhi di un amministratore: niente credenziali.
    expect(database.dove).toContain(".db");
    expect(database.dove).not.toMatch(/:\/\/|password|@/i);
  });

  it("dichiara le versioni davvero installate, non i vincoli del package.json", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/system",
      headers: { cookie: adminCookie },
    });
    const versions = res.json().versions as Array<{ name: string; version: string }>;
    const trovate = new Map(versions.map((v) => [v.name, v.version]));
    for (const atteso of ["Node.js", "SQLite", "fastify", "@prisma/client", "better-sqlite3"]) {
      expect(trovate.has(atteso), `manca ${atteso}`).toBe(true);
    }
    // Numeri esatti: un "^5.10.0" qui vorrebbe dire che stiamo leggendo il
    // vincolo dichiarato invece di quello che sta girando.
    for (const [name, version] of trovate) {
      expect(version, name).toMatch(/^\d+\.\d+/);
    }

    // L'elenco si deriva dal package.json: nessuna dipendenza dichiarata deve
    // mancare all'appello, altrimenti la pagina Sistema racconta a metà.
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const dichiarate = Object.keys(pkg.dependencies ?? {}).filter(
      (name) => !name.startsWith("@kancrm/"),
    );
    for (const name of dichiarate) {
      expect(trovate.has(name), `${name} non compare tra le versioni`).toBe(true);
    }
  });

  it("un file della build che non c'è più risponde 404, non l'index", async () => {
    // Pagina aperta da prima di un rilascio: chiede un chunk con l'impronta
    // vecchia. Rispondere l'index (text/html) dà un errore di MIME che non dice
    // niente e lascia la pagina rotta; il 404 lo fa capire al client, che ricarica.
    const asset = await app.inject({ method: "GET", url: "/assets/vecchio-ABC123.js" });
    expect(asset.statusCode).toBe(404);
    expect(asset.headers["content-type"]).not.toContain("text/html");

    // Una rotta dell'applicazione invece continua a servire la pagina.
    const page = await app.inject({ method: "GET", url: "/progetti" });
    expect([200, 404]).toContain(page.statusCode); // 200 con la build, 404 senza
  });

  it("backup returns a zip archive", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/backup",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    // Magic bytes ZIP: PK\x03\x04
    expect(response.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });
});

/**
 * Il pannello **L'andamento** ("La mia giornata"): chi lo vede, e cosa dicono i
 * numeri. La regola del perimetro è quella dell'area tecnica — chi ci lavora o
 * chi la governa — e i tempi non contano i task nati già chiusi.
 */
describe("andamento dell'area tecnica", () => {
  let devCookie: string;
  let devId: string;

  beforeAll(async () => {
    // Gruppo che governa l'area DEV: è la stessa appartenenza del promemoria
    // del timesheet, non un elenco nuovo.
    const devGroup = await prisma.group.create({
      data: { name: "Sviluppatori", managedArea: "DEV" },
    });
    const dev = await prisma.user.create({
      data: {
        email: "dev@test.local",
        name: "Dora Dev",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("dev12345"),
        groups: { create: { groupId: devGroup.id } },
      },
    });
    devId = dev.id;
    devCookie = await loginCookie("dev@test.local", "dev12345");

    const closedDev = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: true },
    });
    const openDev = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: false },
      orderBy: { order: "asc" },
    });
    const project = await prisma.project.create({ data: { name: "Progetto tecnico" } });

    // Un solo `Date.now()` per tutte le date: con due chiamate, il millisecondo
    // che scatta fra l'una e l'altra fa uscire "due giorni" come 1,99999998 e
    // il test cade a caso (20/08/2026).
    const adesso = Date.now();
    const ieri = new Date(adesso - 24 * 3600_000);
    const treGiorniFa = new Date(adesso - 3 * 24 * 3600_000);

    /**
     * Un task **nato qui** lascia subito la sua traccia nel registro attività:
     * è quella che lo distingue da un record importato con la data d'origine.
     * Le fixture devono quindi scriverla, come fa la rotta vera.
     */
    const devTask = async (
      title: string,
      data: { statusId: string; createdAt?: Date; closedAt?: Date; firstLogAt?: Date },
    ) => {
      const task = await prisma.task.create({
        data: {
          title,
          kind: TaskKind.PROJECT,
          projectId: project.id,
          statusId: data.statusId,
          assigneeId: devId,
          creatorId: devId,
          ...(data.createdAt ? { createdAt: data.createdAt } : {}),
          ...(data.closedAt ? { closedAt: data.closedAt } : {}),
        },
      });
      await prisma.activityLog.create({
        data: {
          taskId: task.id,
          userId: devId,
          action: "created",
          createdAt: data.firstLogAt ?? data.createdAt ?? new Date(),
        },
      });
      return task;
    };

    // Uno che ha vissuto tre giorni…
    const vissuto = await devTask("Lavoro vero", {
      statusId: closedDev.id,
      createdAt: treGiorniFa,
      closedAt: ieri,
    });
    // …uno scritto a cose fatte: creato e chiuso nello stesso minuto…
    await devTask("Annotato dopo", {
      statusId: closedDev.id,
      createdAt: ieri,
      closedAt: ieri,
    });
    // …e uno di archivio: la data d'origine è di un anno fa, ma qui dentro è
    // comparso ieri, al caricamento. Non è lavoro di questa settimana.
    await devTask("Storico da ClickUp", {
      statusId: closedDev.id,
      createdAt: new Date(adesso - 365 * 24 * 3600_000),
      closedAt: ieri,
      firstLogAt: ieri,
    });
    await devTask("Ancora aperto", { statusId: openDev.id });

    // Un task tecnico intestato a un cliente del portale: non è lavoro della
    // squadra e non deve comparire in nessun conto (in produzione erano due su
    // 349, e facevano solo un totale che non tornava).
    const cliente = await prisma.user.create({
      data: {
        email: "cliente@test.local",
        name: "Carla Cliente",
        role: UserRole.PORTAL,
        passwordHash: await hashPassword("cliente1234"),
      },
    });
    const delCliente = await prisma.task.create({
      data: {
        title: "Aperto ma in mano al cliente",
        kind: TaskKind.PROJECT,
        projectId: project.id,
        statusId: openDev.id,
        assigneeId: cliente.id,
        creatorId: devId,
      },
    });
    await prisma.activityLog.create({
      data: { taskId: delCliente.id, userId: devId, action: "created" },
    });

    await prisma.timeEntry.create({
      data: { userId: devId, taskId: vissuto.id, date: startOfDayUTC(ieri), hours: 3 },
    });
  });

  it("lo vede chi lavora nell'area, non chi le è estraneo", async () => {
    const dentro = await app.inject({
      method: "GET",
      url: "/api/dashboard/dev-metrics",
      headers: { cookie: devCookie },
    });
    expect(dentro.statusCode).toBe(200);

    const fuori = await app.inject({
      method: "GET",
      url: "/api/dashboard/dev-metrics",
      headers: { cookie: memberCookie },
    });
    expect(fuori.statusCode).toBe(403);
  });

  it("lo storico importato non conta come lavoro chiuso, ma si dichiara", async () => {
    // Sui dati veri erano 104 record su 155 "chiusi" in quattro settimane, e i
    // tempi di squadra uscivano di 156 giorni (18/08/2026).
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard/dev-metrics",
      headers: { cookie: devCookie },
    });
    const body = response.json();
    expect(body.team.storico).toBe(1);
    expect(body.team.chiusi).toBe(2);
    expect(body.team.tempi.totale).toBe(2);
  });

  it("i tempi ignorano i task nati già chiusi, e lo dicono", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard/dev-metrics",
      headers: { cookie: devCookie },
    });
    const body = response.json();
    expect(body.me.chiusi).toBe(2);
    expect(body.me.natiChiusi).toBe(1);
    // Il tempo è quello del solo task che ha vissuto: due giorni, non uno.
    expect(body.me.tempi.campione).toBe(1);
    expect(body.me.tempi.totale).toBe(2);
    expect(body.me.aperti).toBe(1);
    // Le ore danno la taglia: tre ore su un task chiuso su due.
    expect(body.me.ore).toBe(3);
    expect(body.me.taglia.medianaOre).toBe(3);
    expect(body.me.taglia.conOre).toBe(1);
    expect(body.me.taglia.totali).toBe(2);
  });

  it("il lavoro in mano a un utente del portale resta fuori da ogni conto", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard/dev-metrics",
      headers: { cookie: adminCookie },
    });
    const body = response.json();
    // Aperti: solo quello del dev. Il task del cliente non c'è, e nemmeno la
    // riga della persona — le quote della coda devono tornare da sole.
    expect(body.team.aperti).toBe(1);
    const people = body.people as Array<{ name: string; assegnati: number }>;
    expect(people.map((p) => p.name)).not.toContain("Carla Cliente");
    const somma = people.reduce((n, p) => n + p.assegnati, 0) + body.team.nonAssegnati;
    expect(somma).toBe(body.team.aperti);
  });

  it("l'elenco per persona è solo di chi governa l'area", async () => {
    const perIlDev = await app.inject({
      method: "GET",
      url: "/api/dashboard/dev-metrics",
      headers: { cookie: devCookie },
    });
    expect(perIlDev.json().people).toBeNull();

    const perLAdmin = await app.inject({
      method: "GET",
      url: "/api/dashboard/dev-metrics",
      headers: { cookie: adminCookie },
    });
    const people = perLAdmin.json().people as Array<{ name: string; ore: number }>;
    expect(people.map((p) => p.name)).toContain("Dora Dev");
    expect(people.find((p) => p.name === "Dora Dev")!.ore).toBe(3);
  });
});

function startOfDayUTC(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}
