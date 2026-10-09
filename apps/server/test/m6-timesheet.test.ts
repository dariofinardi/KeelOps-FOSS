import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { m6Scenario, settimaneDiMaggio } from "./support/m6-scenario";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("m6");

type App = Awaited<ReturnType<typeof m6Scenario>>["app"];
let app: App;
let workerCookie: string;
let managerCookie: string;
let adminCookie: string;
let workerId: string;
let managerId: string;
let adminTaskId: string;
let projectTaskId: string;
let projectId: string;
let hiddenProjectTaskId: string;

let prisma: Awaited<ReturnType<typeof m6Scenario>>["prisma"];
let putEntry: Awaited<ReturnType<typeof m6Scenario>>["putEntry"];
const MONTH = "2026-07";

beforeAll(async () => {
  const ctx = await m6Scenario();
  ({
    app,
    prisma,
    adminCookie,
    workerCookie,
    managerCookie,
    workerId,
    managerId,
    adminTaskId,
    projectTaskId,
    projectId,
    hiddenProjectTaskId,
    putEntry,
  } = ctx);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("registrazione ore", () => {
  it("upserts entries and shows them in the month grid with totals", async () => {
    expect(
      (await putEntry(workerCookie, { taskId: adminTaskId, date: "2026-07-01", hours: 4 }))
        .statusCode,
    ).toBe(200);
    expect(
      (await putEntry(workerCookie, { taskId: projectTaskId, date: "2026-07-01", hours: 3.5 }))
        .statusCode,
    ).toBe(200);
    // Aggiornamento della stessa cella.
    expect(
      (await putEntry(workerCookie, { taskId: adminTaskId, date: "2026-07-01", hours: 5 }))
        .statusCode,
    ).toBe(200);

    const grid = await app.inject({
      method: "GET",
      url: `/api/timesheet?month=${MONTH}`,
      headers: { cookie: workerCookie },
    });
    expect(grid.statusCode).toBe(200);
    const data = grid.json();
    expect(data.editable).toBe(true);
    expect(data.total).toBe(8.5);
    const adminRow = data.rows.find((r: { task: { id: string } }) => r.task.id === adminTaskId);
    expect(adminRow.entries["2026-07-01"]).toBe(5);
    expect(adminRow.task.context).toBe("Scadenzario");
  });

  it("accetta i centesimi di ora e arrotonda quello che centesimo non è", async () => {
    // 4,2 sono quattro ore e dodici minuti: si registrano così come sono.
    const decimi = await putEntry(workerCookie, {
      taskId: adminTaskId,
      date: "2026-07-02",
      hours: 4.2,
    });
    expect(decimi.statusCode).toBe(200);
    expect(JSON.parse(decimi.body).hours).toBe(4.2);

    // Anche i quarti d'ora, che sono il grosso dello storico.
    const quarto = await putEntry(workerCookie, {
      taskId: adminTaskId,
      date: "2026-07-02",
      hours: 0.75,
    });
    expect(quarto.statusCode).toBe(200);
    expect(JSON.parse(quarto.body).hours).toBe(0.75);

    // Un client che manda un valore più fine intende comunque un'ora valida:
    // si sceglie il centesimo più vicino invece di rifiutare la registrazione.
    const arrotondato = await putEntry(workerCookie, {
      taskId: adminTaskId,
      date: "2026-07-02",
      hours: 4.247,
    });
    expect(arrotondato.statusCode).toBe(200);
    expect(JSON.parse(arrotondato.body).hours).toBe(4.25);

    // E quello che finisce nel database è il valore arrotondato, non l'originale.
    const salvate = await prisma.timeEntry.findFirst({
      where: { taskId: adminTaskId, date: new Date("2026-07-02T00:00:00.000Z") },
    });
    expect(salvate?.hours).toBe(4.25);

    // Si rimette il mese com'era: i totali li leggono i test dei riepiloghi.
    await putEntry(workerCookie, { taskId: adminTaskId, date: "2026-07-02", hours: 0 });
  });

  it("enforces the 24h/day limit", async () => {
    expect(
      (await putEntry(workerCookie, { taskId: adminTaskId, date: "2026-07-03", hours: 20 }))
        .statusCode,
    ).toBe(200);
    const overflow = await putEntry(workerCookie, {
      taskId: projectTaskId,
      date: "2026-07-03",
      hours: 4.25,
    });
    expect(overflow.statusCode).toBe(400);
    expect(overflow.body).toContain("24 ore");
  });

  it("hours=0 deletes the entry", async () => {
    await putEntry(workerCookie, { taskId: adminTaskId, date: "2026-07-04", hours: 2 });
    await putEntry(workerCookie, { taskId: adminTaskId, date: "2026-07-04", hours: 0 });
    const grid = await app.inject({
      method: "GET",
      url: `/api/timesheet?month=${MONTH}`,
      headers: { cookie: workerCookie },
    });
    const row = grid.json().rows.find((r: { task: { id: string } }) => r.task.id === adminTaskId);
    expect(row.entries["2026-07-04"]).toBeUndefined();
  });

  it("deletes a whole row (all own entries of the task in the month)", async () => {
    const status = await prisma.taskStatus.findFirstOrThrow();
    const rowTask = await prisma.task.create({
      data: { kind: "ADMIN", title: "Task riga", statusId: status.id, creatorId: workerId },
    });
    await putEntry(workerCookie, { taskId: rowTask.id, date: "2026-07-10", hours: 2 });
    await putEntry(workerCookie, { taskId: rowTask.id, date: "2026-07-11", hours: 3 });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/timesheet/rows/${rowTask.id}?period=${MONTH}`,
      headers: { cookie: workerCookie },
    });
    expect(deleted.statusCode).toBe(204);

    const grid = await app.inject({
      method: "GET",
      url: `/api/timesheet?month=${MONTH}`,
      headers: { cookie: workerCookie },
    });
    const row = grid.json().rows.find((r: { task: { id: string } }) => r.task.id === rowTask.id);
    expect(row).toBeUndefined();
  });

  it("blocks logging on tasks the user cannot see", async () => {
    const response = await putEntry(workerCookie, {
      taskId: hiddenProjectTaskId,
      date: "2026-07-01",
      hours: 1,
    });
    expect(response.statusCode).toBe(404); // il progetto non risulta esistere
  });

  it("la riga porta con sé progetto, cliente e i contatori delle sbirciatine", async () => {
    // La colonna del task mostra "progetto · cliente" e le due icone con i
    // numeri: senza questi campi la riga non saprebbe cosa disegnare.
    const cliente = await prisma.company.create({ data: { name: "Boreal" } });
    await prisma.project.update({ where: { id: projectId }, data: { companyId: cliente.id } });
    await prisma.comment.create({
      data: { taskId: projectTaskId, authorId: workerId, body: "Prima nota" },
    });
    await putEntry(workerCookie, { taskId: projectTaskId, date: "2026-11-03", hours: 2 });

    const res = await app.inject({
      method: "GET",
      url: "/api/timesheet?month=2026-11",
      headers: { cookie: workerCookie },
    });
    const riga = res.json().rows.find((r: { task: { id: string } }) => r.task.id === projectTaskId);
    expect(riga.task.context).toBe("Progetto Ore");
    expect(riga.task.company).toBe("Boreal");
    expect(riga.task.commentCount).toBe(1);
    expect(riga.task.attachmentCount).toBe(0);
  });

  it("una riga aggiunta senza ore resta in griglia, e si toglie quando serve", async () => {
    // Chi si prepara la settimana mette in griglia i task da lavorare: prima
    // sparivano al primo ricaricamento, perché vivevano solo nel browser.
    const aggiunta = await app.inject({
      method: "POST",
      url: "/api/timesheet/rows",
      headers: { cookie: workerCookie },
      payload: { taskId: projectTaskId, period: "2026-09" },
    });
    expect(aggiunta.statusCode).toBe(201);

    const mese = async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/timesheet?month=2026-09",
        headers: { cookie: workerCookie },
      });
      return res.json() as { rows: Array<{ task: { id: string }; total: number }> };
    };
    const conRiga = await mese();
    expect(conRiga.rows.map((r) => r.task.id)).toContain(projectTaskId);
    expect(conRiga.rows.find((r) => r.task.id === projectTaskId)!.total).toBe(0);

    // Ripetere l'aggiunta non crea doppioni.
    await app.inject({
      method: "POST",
      url: "/api/timesheet/rows",
      headers: { cookie: workerCookie },
      payload: { taskId: projectTaskId, period: "2026-09" },
    });
    expect((await mese()).rows.filter((r) => r.task.id === projectTaskId)).toHaveLength(1);

    // Vale per quel mese soltanto: ottobre riparte pulito.
    const ottobre = await app.inject({
      method: "GET",
      url: "/api/timesheet?month=2026-10",
      headers: { cookie: workerCookie },
    });
    expect(ottobre.json().rows).toEqual([]);

    // Il cestino della riga la toglie davvero.
    const tolta = await app.inject({
      method: "DELETE",
      url: `/api/timesheet/rows/${projectTaskId}?period=2026-09`,
      headers: { cookie: workerCookie },
    });
    expect(tolta.statusCode).toBe(204);
    expect((await mese()).rows).toEqual([]);
  });

  it("in griglia si tiene solo ciò che si può vedere", async () => {
    const negata = await app.inject({
      method: "POST",
      url: "/api/timesheet/rows",
      headers: { cookie: workerCookie },
      payload: { taskId: hiddenProjectTaskId, period: "2026-09" },
    });
    expect([403, 404]).toContain(negata.statusCode);
  });

  it("la tendina parte dai propri task e, cercando, si allarga a quelli visibili", async () => {
    const chiedi = async (query = "") => {
      const response = await app.inject({
        method: "GET",
        url: `/api/timesheet/visible-tasks${query}`,
        headers: { cookie: workerCookie },
      });
      expect(response.statusCode).toBe(200);
      return response.json() as { items: Array<{ id: string; title: string }>; hasMore: boolean };
    };

    // Senza scrivere niente: quello che si ha in mano. Il task amministrativo
    // "Contabilità" è visibile ma di nessuno, e non ingombra l'elenco.
    await prisma.task.update({ where: { id: projectTaskId }, data: { assigneeId: workerId } });
    const miei = await chiedi();
    expect(miei.items.map((t) => t.id)).toEqual([projectTaskId]);

    // Anche da referente: è lavoro che segue, e ci può imputare le ore.
    await prisma.task.update({ where: { id: adminTaskId }, data: { supervisorId: workerId } });
    expect((await chiedi()).items.map((t) => t.id)).toContain(adminTaskId);

    // Cercando si vede tutto il visibile, non solo il proprio; e mai i progetti
    // di cui non si è membri.
    const cercati = (await chiedi("?q=o")).items.map((t) => t.id);
    expect(cercati).toContain(adminTaskId);
    expect(cercati).toContain(projectTaskId);
    expect(cercati).not.toContain(hiddenProjectTaskId);
  });

  it("un task assegnato in un progetto di cui non si è membri entra in tendina", async () => {
    // Il perimetro era scritto due volte (ricerca e timesheet) ed era divergente:
    // qui il task assegnato fuori membership non compariva, ma le ore ci si
    // possono mettere. Ora la regola è una sola (visibleTaskWhere).
    await prisma.task.update({
      where: { id: hiddenProjectTaskId },
      data: { assigneeId: workerId },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks",
      headers: { cookie: workerCookie },
    });
    expect(res.json().items.map((t: { id: string }) => t.id)).toContain(hiddenProjectTaskId);

    // Tolta l'assegnazione, il progetto nascosto torna invisibile anche cercando.
    await prisma.task.update({
      where: { id: hiddenProjectTaskId },
      data: { assigneeId: null },
    });
    const cercato = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks?q=nascosto",
      headers: { cookie: workerCookie },
    });
    expect(cercato.json().items).toEqual([]);
  });

  it("senza cercare, prima i task toccati per ultimi", async () => {
    // Chi apre la tendina sta imputando le ore di oggi: davanti va quello su cui
    // ha appena lavorato, non quello che comincia per A.
    const status = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
    });
    const crea = (title: string, updatedAt: string) =>
      prisma.task.create({
        data: {
          kind: "ADMIN",
          title,
          statusId: status.id,
          creatorId: workerId,
          assigneeId: workerId,
          updatedAt: new Date(updatedAt),
        },
      });
    const vecchio = await crea("Aaa toccato a luglio", "2026-07-01T09:00:00Z");
    const recente = await crea("Zzz modificato ieri", "2026-08-05T18:00:00Z");
    const commentato = await crea("Mmm commentato stamattina", "2026-07-02T09:00:00Z");
    // Un commento non cambia la riga del task, ma è "metterci le mani".
    await prisma.activityLog.create({
      data: {
        taskId: commentato.id,
        userId: workerId,
        action: "commented",
        createdAt: new Date("2026-08-06T08:45:00Z"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks",
      headers: { cookie: workerCookie },
    });
    const ids = res.json().items.map((t: { id: string }) => t.id) as string[];
    expect(ids.indexOf(commentato.id)).toBeLessThan(ids.indexOf(recente.id));
    expect(ids.indexOf(recente.id)).toBeLessThan(ids.indexOf(vecchio.id));

    // Ripulisce: gli altri casi contano gli elementi in tendina.
    await prisma.activityLog.deleteMany({ where: { taskId: commentato.id } });
    await prisma.task.deleteMany({
      where: { id: { in: [vecchio.id, recente.id, commentato.id] } },
    });
  });

  it("l'elenco è alfabetico e arriva a blocchi", async () => {
    const status = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
    });
    // Più di una pagina di task, creati in ordine sparso.
    for (const n of [40, 5, 22, 31, 8]) {
      await prisma.task.create({
        data: {
          kind: "ADMIN",
          title: `Zeta pagina ${String(n).padStart(2, "0")}`,
          statusId: status.id,
          creatorId: workerId,
          assigneeId: workerId,
        },
      });
    }
    const primo = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks?q=Zeta pagina",
      headers: { cookie: workerCookie },
    });
    const titoli = primo.json().items.map((t: { title: string }) => t.title);
    expect(titoli).toEqual([...titoli].sort());

    // La seconda pagina riparte da dove finisce la prima.
    const secondo = await app.inject({
      method: "GET",
      url: `/api/timesheet/visible-tasks?q=Zeta pagina&skip=${titoli.length}`,
      headers: { cookie: workerCookie },
    });
    expect(secondo.json().items).toEqual([]);
    expect(secondo.json().hasMore).toBe(false);
  });

  it("timesheet altrui: manager vede i propri progetti, admin tutto, il permesso apre tutto", async () => {
    // Un membro semplice non è team-viewer: niente elenco utenti.
    const noUsers = await app.inject({
      method: "GET",
      url: "/api/timesheet/users",
      headers: { cookie: workerCookie },
    });
    expect(noUsers.statusCode).toBe(403);

    // Il manager di progetto è team-viewer e vede le ore di Willy SUL PROPRIO progetto,
    // non su un task amministrativo che non gestisce.
    const mgrUsers = await app.inject({
      method: "GET",
      url: "/api/timesheet/users",
      headers: { cookie: managerCookie },
    });
    expect(mgrUsers.statusCode).toBe(200);
    const mgrGrid = await app.inject({
      method: "GET",
      url: `/api/timesheet?month=${MONTH}&userIds=${workerId}`,
      headers: { cookie: managerCookie },
    });
    expect(mgrGrid.statusCode).toBe(200);
    expect(mgrGrid.json().editable).toBe(false);
    const mgrRows = mgrGrid.json().rows as Array<{ task: { id: string } }>;
    expect(mgrRows.find((r) => r.task.id === projectTaskId)).toBeTruthy();
    expect(mgrRows.find((r) => r.task.id === adminTaskId)).toBeUndefined();

    // L'admin vede tutto il grid di Willy (anche il task amministrativo), in sola lettura.
    const adminGrid = await app.inject({
      method: "GET",
      url: `/api/timesheet?month=${MONTH}&userIds=${workerId}`,
      headers: { cookie: adminCookie },
    });
    expect(adminGrid.json().editable).toBe(false);
    const adminRows = adminGrid.json().rows as Array<{ task: { id: string } }>;
    expect(adminRows.find((r) => r.task.id === adminTaskId)).toBeTruthy();

    // Il permesso "vede tutti i timesheet" apre l'accesso a un membro semplice.
    await prisma.user.update({ where: { id: workerId }, data: { canViewAllTimesheets: true } });
    const nowAllowed = await app.inject({
      method: "GET",
      url: "/api/timesheet/users",
      headers: { cookie: workerCookie },
    });
    expect(nowAllowed.statusCode).toBe(200);
    await prisma.user.update({ where: { id: workerId }, data: { canViewAllTimesheets: false } });
  });
});

describe("riepiloghi ed export", () => {
  it("project MANAGER sees team hours on their projects, not other data", async () => {
    const summary = await app.inject({
      method: "GET",
      url: `/api/timesheet/summary?month=${MONTH}&groupBy=user`,
      headers: { cookie: managerCookie },
    });
    const rows = summary.json();
    // Vede le ore di Willy sul suo progetto (3.5), ma non quelle su Contabilità (25).
    const willy = rows.find((r: { label: string }) => r.label === "Willy Worker");
    expect(willy.hours).toBe(3.5);
  });

  it("admin sees everything grouped by project context", async () => {
    const summary = await app.inject({
      method: "GET",
      url: `/api/timesheet/summary?month=${MONTH}&groupBy=project`,
      headers: { cookie: adminCookie },
    });
    const rows = summary.json();
    const scadenzario = rows.find((r: { label: string }) => r.label === "Scadenzario");
    const progetto = rows.find((r: { label: string }) => r.label === "Progetto Ore");
    expect(scadenzario.hours).toBe(25); // 5 + 20
    expect(progetto.hours).toBe(3.5);
  });

  it("per task ogni riga porta il proprio progetto, e omonimi non si sommano", async () => {
    // Due task con lo STESSO titolo in contesti diversi: prima venivano fusi in
    // una riga sola, che è proprio l'informazione che il riepilogo deve dare.
    const omonimo = await prisma.task.create({
      data: {
        kind: "PROJECT",
        title: "Test e bug fixing",
        statusId: (await prisma.taskStatus.findFirstOrThrow({ where: { category: "DEV" } })).id,
        creatorId: workerId,
        projectId: projectId,
      },
    });
    const adminOmonimo = await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Test e bug fixing",
        statusId: (await prisma.taskStatus.findFirstOrThrow({ where: { category: "ADMIN" } })).id,
        creatorId: workerId,
      },
    });
    for (const [taskId, hours] of [
      [omonimo.id, 2],
      [adminOmonimo.id, 3],
    ] as const) {
      await prisma.timeEntry.create({
        data: { userId: workerId, taskId, date: new Date(`${MONTH}-20T00:00:00.000Z`), hours },
      });
    }

    const rows = (
      await app.inject({
        method: "GET",
        url: `/api/timesheet/summary?month=${MONTH}&groupBy=task`,
        headers: { cookie: adminCookie },
      })
    ).json() as Array<{ label: string; hours: number; context: string | null }>;

    const omonime = rows.filter((r) => r.label === "Test e bug fixing");
    expect(omonime).toHaveLength(2);
    expect(omonime.map((r) => r.context).sort()).toEqual(["Progetto Ore", "Scadenzario"]);
    expect(omonime.find((r) => r.context === "Progetto Ore")?.hours).toBe(2);
    expect(omonime.find((r) => r.context === "Scadenzario")?.hours).toBe(3);
  });

  it("elenco utenti timesheet: include i disattivati con ore, solo admin", async () => {
    // Utente uscito dall'azienda ma con ore registrate.
    const kai = await prisma.user.create({
      data: { email: "kai@test.local", name: "Kai Uscito", role: UserRole.MEMBER, isActive: false },
    });
    await prisma.timeEntry.create({
      data: {
        userId: kai.id,
        taskId: adminTaskId,
        date: new Date("2026-07-02T00:00:00.000Z"),
        hours: 3,
      },
    });

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/timesheet/users",
      headers: { cookie: workerCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: "GET",
      url: "/api/timesheet/users",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ name: string; isActive: boolean }>;
    expect(list.find((u) => u.name === "Kai Uscito")).toMatchObject({ isActive: false });
    expect(list.find((u) => u.name === "Willy Worker")).toMatchObject({ isActive: true });
  });

  it("supervisionare dei task non apre il timesheet degli altri", async () => {
    // Ogni task nasce con il proprio creatore come referente: se bastasse la
    // supervisione, la tendina degli altrui comparirebbe a chiunque abbia mai
    // aperto un task — che in produzione era quasi tutta l'azienda.
    await prisma.task.updateMany({ where: { id: adminTaskId }, data: { supervisorId: workerId } });
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: workerCookie },
    });
    expect(me.json().canViewTeamTimesheet).toBe(false);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/timesheet/users",
          headers: { cookie: workerCookie },
        })
      ).statusCode,
    ).toBe(403);
    // Le ore sui task che segue restano visibili: è un'altra cosa.
    const griglia = await app.inject({
      method: "GET",
      url: `/api/timesheet?month=${MONTH}&userIds=${workerId},${managerId}`,
      headers: { cookie: workerCookie },
    });
    expect(griglia.statusCode).toBe(200);
  });

  it("un manager di progetto propone solo le persone dei suoi progetti", async () => {
    // Non l'intera azienda: una tendina che elenca chi non si può guardare
    // promette quello che poi la griglia non mostra.
    const estranea = await prisma.user.create({
      data: { email: "estranea@test.local", name: "Elsa Estranea", role: UserRole.MEMBER },
    });
    await prisma.timeEntry.create({
      data: {
        userId: estranea.id,
        taskId: adminTaskId,
        date: new Date("2026-07-05T00:00:00.000Z"),
        hours: 2,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/timesheet/users",
      headers: { cookie: managerCookie },
    });
    expect(res.statusCode).toBe(200);
    const nomi = (res.json() as Array<{ name: string }>).map((u) => u.name);
    expect(nomi).toContain("Willy Worker"); // membro del progetto che gestisce
    expect(nomi).not.toContain("Elsa Estranea");

    // L'admin invece continua a vederle tutte.
    const perAdmin = (
      await app.inject({
        method: "GET",
        url: "/api/timesheet/users",
        headers: { cookie: adminCookie },
      })
    ).json() as Array<{ name: string }>;
    expect(perAdmin.map((u) => u.name)).toContain("Elsa Estranea");
  });

  it("breakdown per progetto: dettaglio per persona + filtro multi-utente", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/timesheet/breakdown?month=${MONTH}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{
      label: string;
      hours: number;
      people: Array<{ userId: string; hours: number }>;
    }>;
    const scad = rows.find((r) => r.label === "Scadenzario");
    expect(scad).toBeTruthy();
    // Il totale del progetto è la somma delle persone.
    expect(scad!.hours).toBeCloseTo(scad!.people.reduce((s, p) => s + p.hours, 0));

    // Filtro su un solo utente: nelle righe compaiono solo le sue ore.
    const filtered = await app.inject({
      method: "GET",
      url: `/api/timesheet/breakdown?month=${MONTH}&userIds=${workerId}`,
      headers: { cookie: adminCookie },
    });
    const frows = filtered.json() as Array<{ people: Array<{ userId: string }> }>;
    for (const row of frows) {
      for (const person of row.people) expect(person.userId).toBe(workerId);
    }
  });

  it("griglia aggregata: più utenti sommano le ore per cella, in sola lettura", async () => {
    await putEntry(workerCookie, { taskId: projectTaskId, date: "2026-07-10", hours: 2 });
    await putEntry(managerCookie, { taskId: projectTaskId, date: "2026-07-10", hours: 3 });

    const res = await app.inject({
      method: "GET",
      url: `/api/timesheet?month=${MONTH}&userIds=${workerId},${managerId}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.editable).toBe(false);
    const row = data.rows.find((r: { task: { id: string } }) => r.task.id === projectTaskId);
    expect(row.entries["2026-07-10"]).toBe(5); // 2 (worker) + 3 (manager)
  });
});

describe("griglia della settimana", () => {
  // Maggio 2027: il 3 e il 10 sono lunedì. Un task lavorato nella prima
  // settimana, uno nella seconda. Le righe dalle attività e la pulizia sono
  // commerciali: commercial/m6-timesheet-extras.test.ts.
  const WEEK_1 = "2027-05-03";
  const MONTH_5 = "2027-05";
  let primaSettimana: string;

  const griglia = async (period: string) => {
    const response = await app.inject({
      method: "GET",
      url: `/api/timesheet?period=${period}`,
      headers: { cookie: workerCookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json().rows.map((r: { task: { id: string } }) => r.task.id) as string[];
  };

  beforeAll(async () => {
    ({ primaSettimana } = await settimaneDiMaggio(prisma, workerId));
  });

  it("una riga aggiunta al MESE non ricompare in ogni settimana", async () => {
    // Il motivo per cui la vista stretta serve: con venticinque righe mensili
    // in ogni settimana, la settimana torna larga come il mese (12/08/2026).
    const open = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
      orderBy: { order: "asc" },
    });
    const mensile = await prisma.task.create({
      data: { kind: "ADMIN", title: "Riga del mese", statusId: open.id, creatorId: workerId },
    });
    const added = await app.inject({
      method: "POST",
      url: "/api/timesheet/rows",
      headers: { cookie: workerCookie },
      payload: { taskId: mensile.id, period: MONTH_5 },
    });
    expect(added.statusCode).toBe(201);
    expect(await griglia(MONTH_5)).toContain(mensile.id);
    // Nella settimana non c'è: se serve lì, la si aggiunge lì.
    expect(await griglia(WEEK_1)).not.toContain(mensile.id);
  });

  it("le ore restano quelle: la settimana mostra i suoi giorni", async () => {
    await putEntry(workerCookie, { taskId: primaSettimana, date: "2027-05-05", hours: 3 });
    await putEntry(workerCookie, { taskId: primaSettimana, date: "2027-05-12", hours: 2 });
    const settimana = await app.inject({
      method: "GET",
      url: `/api/timesheet?period=${WEEK_1}`,
      headers: { cookie: workerCookie },
    });
    // Solo le 3 ore del 5: il 12 è la settimana dopo.
    expect(settimana.json().total).toBe(3);
    const mese = await app.inject({
      method: "GET",
      url: `/api/timesheet?period=${MONTH_5}`,
      headers: { cookie: workerCookie },
    });
    expect(mese.json().total).toBe(5);
  });

  it("una settimana che non è un lunedì non è una settimana", async () => {
    // Due chiavi per lo stesso periodo vorrebbero dire due righe per lo stesso
    // task: lo schema lo rifiuta prima di arrivare al database.
    const response = await app.inject({
      method: "GET",
      url: "/api/timesheet?period=2027-05-05",
      headers: { cookie: workerCookie },
    });
    expect(response.statusCode).toBe(400);
  });
});

/**
 * Ore **suggerite** nelle caselle vuote (14/08/2026): un promemoria di quello
 * che hai fatto, scritto in grigio dentro la cella. Non sono ore finché non le
 * riscrivi tu, quindi le cose da tenere ferme sono: da dove esce il numero, e
 * quando NON si suggerisce niente.
 */
describe("scegliere un task per la griglia", () => {
  /**
   * Il difetto segnalato il 14/08/2026: "non riesco ad aggiungere questo task
   * al timesheet". Il task era **chiuso** — assegnato alla persona, nel suo
   * progetto, dentro il perimetro — e la tendina filtrava via i chiusi. Ma si
   * finisce un lavoro, lo si chiude e POI si registrano le ore: era il caso
   * più comune a non funzionare.
   */
  it("un task appena chiuso si trova ancora, cercandolo e in elenco", async () => {
    const chiuso = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: true },
    });
    const task = await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Lavoro finito e chiuso zzzchiusura",
        statusId: chiuso.id,
        assigneeId: workerId,
        creatorId: workerId,
      },
    });

    const cercato = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks?q=zzzchiusura",
      headers: { cookie: workerCookie },
    });
    expect(cercato.statusCode).toBe(200);
    const trovato = cercato.json().items.find((t: { id: string }) => t.id === task.id);
    expect(trovato).toBeDefined();
    // …e si vede che è chiuso, così nessuno si chiede perché è in elenco.
    expect(trovato.isClosed).toBe(true);

    // Anche senza cercare: è tra i propri, in cima perché toccato per ultimo.
    const elenco = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks",
      headers: { cookie: workerCookie },
    });
    expect(elenco.json().items.map((t: { id: string }) => t.id)).toContain(task.id);
  });

  it("senza cercare propone ciò su cui si lavora nel periodo, non gli assegnati intatti", async () => {
    /**
     * Richiesta del 15/08/2026: la tendina deve mostrare i task su cui si sta
     * lavorando nel periodo mostrato. Un task assegnato e mai toccato non è
     * lavoro cominciato — assegnare è un gesto di qualcun altro — e riempiva la
     * tendina di roba che non c'entrava.
     */
    const open = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
      orderBy: { order: "asc" },
    });
    const lavorato = await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Toccato a novembre",
        statusId: open.id,
        assigneeId: workerId,
        creatorId: workerId,
      },
    });
    const intatto = await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Assegnato e mai toccato",
        statusId: open.id,
        assigneeId: workerId,
        creatorId: workerId,
      },
    });
    await prisma.activityLog.create({
      data: {
        taskId: lavorato.id,
        userId: workerId,
        action: "status_changed",
        createdAt: new Date("2027-11-08T10:00:00.000Z"),
      },
    });
    // Sull'altro solo l'assegnazione: burocrazia, non lavoro.
    await prisma.activityLog.create({
      data: {
        taskId: intatto.id,
        userId: workerId,
        action: "assignee_changed",
        createdAt: new Date("2027-11-08T10:05:00.000Z"),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks?period=2027-11",
      headers: { cookie: workerCookie },
    });
    expect(response.statusCode).toBe(200);
    const ids = response.json().items.map((t: { id: string }) => t.id);
    expect(ids).toContain(lavorato.id);
    expect(ids).not.toContain(intatto.id);

    // In un altro periodo non c'è niente: non è lavoro di quei giorni.
    const altro = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks?period=2027-12",
      headers: { cookie: workerCookie },
    });
    expect(altro.json().items.map((t: { id: string }) => t.id)).not.toContain(lavorato.id);

    // …ma cercandolo per nome si trova comunque, che è la via per aggiungere
    // un task su cui non si è ancora messo mano.
    const cercato = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks?q=Assegnato e mai toccato",
      headers: { cookie: workerCookie },
    });
    expect(cercato.json().items.map((t: { id: string }) => t.id)).toContain(intatto.id);
  });

  it("cercando si vedono anche i task dei colleghi che si possono vedere", async () => {
    // La ricerca guarda tutto il perimetro, non solo i propri: si registrano ore
    // su qualunque task visibile, e quindi lo si deve poter trovare.
    const open = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: false },
      orderBy: { order: "asc" },
    });
    const diUnCollega = await prisma.task.create({
      data: {
        kind: "PROJECT",
        title: "Zzzcollega lavoro condiviso",
        statusId: open.id,
        projectId,
        assigneeId: managerId,
        creatorId: managerId,
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks?q=Zzzcollega",
      headers: { cookie: workerCookie },
    });
    expect(response.json().items.map((t: { id: string }) => t.id)).toContain(diUnCollega.id);
  });

  it("il perimetro resta: il task di un progetto altrui non si trova", async () => {
    const cercato = await app.inject({
      method: "GET",
      url: "/api/timesheet/visible-tasks?q=nascosto",
      headers: { cookie: workerCookie },
    });
    const ids = cercato.json().items.map((t: { id: string }) => t.id);
    expect(ids).not.toContain(hiddenProjectTaskId);
  });
});

describe("vista aggregata: il filtro si dichiara", () => {
  it("chi non vede tutto riceve filtered=true; il proprio timesheet mai", async () => {
    // Il caso vero (18/08/2026): un admin non elevato — cioè un membro — apriva
    // il timesheet di quattro colleghi e trovava una riga su 443 ore. Il filtro
    // era giusto; il silenzio no.
    const worker = await prisma.user.findUniqueOrThrow({
      where: { email: "worker@test.local" },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });

    const cookie = workerCookie;
    const aggregata = await app.inject({
      method: "GET",
      url: `/api/timesheet?period=2026-07&userIds=${admin.id}`,
      headers: { cookie },
    });
    expect(aggregata.statusCode).toBe(200);
    expect(aggregata.json().filtered).toBe(true);

    const propria = await app.inject({
      method: "GET",
      url: "/api/timesheet?period=2026-07",
      headers: { cookie },
    });
    expect(propria.json().filtered).toBe(false);

    // L'admin (elevato nelle fixture) vede tutto: nessun avviso da mostrare.
    const daAdmin = await app.inject({
      method: "GET",
      url: `/api/timesheet?period=2026-07&userIds=${worker.id}`,
      headers: { cookie: adminCookie },
    });
    expect(daAdmin.json().filtered).toBe(false);
  });
});
