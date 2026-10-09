import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { NotificationType, TaskKind, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("m5");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { sendDueDigests } = await import("../src/modules/notifications/service");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let managerCookie: string;
let viewerCookie: string;
let outsiderCookie: string;
let adminCookie: string;
let viewerId: string;
let managerId: string;
let adminId: string;
let openStatusId: string;
let closedStatusId: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

beforeAll(async () => {
  // Gruppo con accesso ai task ADMIN: solo il manager ne fa parte.
  const adminTasksGroup = await prisma.group.create({ data: { name: "Amministrazione" } });
  await prisma.visibilitySetting.create({
    data: { scope: "ADMIN_TASKS", groupId: adminTasksGroup.id },
  });

  const manager = await prisma.user.create({
    data: {
      email: "manager@test.local",
      name: "Marta Manager",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("manager1234"),
      groups: { create: { groupId: adminTasksGroup.id } },
    },
  });
  const viewer = await prisma.user.create({
    data: {
      email: "viewer@test.local",
      name: "Vito Viewer",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("viewer1234"),
    },
  });
  await prisma.user.create({
    data: {
      email: "outsider@test.local",
      name: "Osvaldo Outsider",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("outsider1234"),
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Ada Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
      passwordHash: await hashPassword("admin1234"),
    },
  });
  managerId = manager.id;
  viewerId = viewer.id;
  adminId = admin.id;

  // Gli stati arrivano dalle migrazioni, distinti per categoria: i task di
  // progetto usano quelli di sviluppo (è la categoria del modulo).
  const open = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "DEV", isClosed: false },
    orderBy: { order: "asc" },
  });
  const closed = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "DEV", isClosed: true },
    orderBy: { order: "asc" },
  });
  openStatusId = open.id;
  closedStatusId = closed.id;

  // Questi test leggono i messaggi in italiano (scritti prima del multilingua).
  // Gli utenti appena creati nascono con locale "auto" (default di prodotto →
  // inglese): si dichiara la lingua, come fa il setup web con changeLanguage("it").
  await prisma.user.updateMany({ data: { locale: "it" } });
  app = await buildApp();
  managerCookie = await loginCookie("manager@test.local", "manager1234");
  viewerCookie = await loginCookie("viewer@test.local", "viewer1234");
  outsiderCookie = await loginCookie("outsider@test.local", "outsider1234");
  adminCookie = await loginCookie("admin@test.local", "admin1234");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

async function createProject(): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie: managerCookie },
    payload: { name: `Progetto ${Math.floor(Math.random() * 1e9)}` },
  });
  expect(created.statusCode).toBe(201);
  const projectId = created.json().id;
  // Aggiungi il viewer come VIEWER.
  await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/members`,
    headers: { cookie: managerCookie },
    payload: {
      members: [
        { userId: managerId, role: "MANAGER" },
        { userId: viewerId, role: "VIEWER" },
      ],
    },
  });
  return projectId;
}

describe("riepilogo completo delle Bacheche", () => {
  it("mostra i task di progetto SU CUI SI LAVORA, non tutti quelli dei propri progetti", async () => {
    const projectId = await createProject(); // manager MANAGER, viewer VIEWER
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: {
        title: "Task tecnico del riepilogo",
        projectId,
        statusId: openStatusId,
        assigneeId: managerId,
      },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id;

    const list = async (cookie: string, wide: boolean, category?: string) => {
      const query = [wide ? "includeProjectTasks=true" : "", category ? `category=${category}` : ""]
        .filter(Boolean)
        .join("&");
      const response = await app.inject({
        method: "GET",
        url: `/api/tasks${query ? `?${query}` : ""}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      return response.json();
    };

    // Senza il flag resta lo scadenzario di sempre: nessun task di progetto.
    expect((await list(managerCookie, false)).items.map((t: { id: string }) => t.id)).not.toContain(
      taskId,
    );
    // Con il flag il membro del progetto lo vede, e la riga porta il progetto
    // (serve alla freccia che lo apre).
    const wide = await list(managerCookie, true);
    const row = wide.items.find((t: { id: string }) => t.id === taskId);
    expect(row).toBeDefined();
    expect(row.project.id).toBe(projectId);
    // …e l'area tecnica compare tra quelle offerte, ora che ha dei task.
    expect(wide.facets.areas.map((a: { category: string }) => a.category)).toContain("DEV");

    // Chi nel progetto non c'è non lo vede: il riepilogo allarga la vista, non i permessi.
    expect((await list(outsiderCookie, true)).items.map((t: { id: string }) => t.id)).not.toContain(
      taskId,
    );
    // …nemmeno scegliendo un'AREA. Il filtro d'area viaggiava nella stessa
    // chiave `AND` del perimetro e la sovrascriveva: selezionare "area tecnica"
    // spegneva i permessi e mostrava i task di tutti, mentre i numeri delle
    // tendine (che quel filtro non lo applicano) restavano giusti (11/08/2026).
    const perArea = await list(outsiderCookie, true, "DEV");
    expect(perArea.items.map((t: { id: string }) => t.id)).not.toContain(taskId);
    expect(perArea.total).toBe(perArea.items.length);

    // E il solo essere MEMBRI non basta: il viewer è nel progetto (e il task lo
    // vede aprendo il progetto), ma nel suo riepilogo non deve comparire —
    // sarebbe il lavoro di un altro (11/08/2026).
    expect((await list(viewerCookie, true)).items.map((t: { id: string }) => t.id)).not.toContain(
      taskId,
    );
    // Diventandone supervisore, invece, entra: è lavoro suo.
    await prisma.task.update({ where: { id: taskId }, data: { supervisorId: viewerId } });
    expect((await list(viewerCookie, true)).items.map((t: { id: string }) => t.id)).toContain(
      taskId,
    );

    // Archiviato il progetto, il suo lavoro esce dal riepilogo (11/08/2026):
    // "archiviato" vuol dire che non ci si lavora più, e quei task aperti non
    // li chiuderà nessuno. Dentro il progetto invece si vedono ancora: è lì che
    // si va a guardare il passato.
    const archived = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: managerCookie },
      payload: { isArchived: true },
    });
    expect(archived.statusCode).toBe(200);
    expect((await list(managerCookie, true)).items.map((t: { id: string }) => t.id)).not.toContain(
      taskId,
    );
    expect((await list(viewerCookie, true)).items.map((t: { id: string }) => t.id)).not.toContain(
      taskId,
    );
    // Vale anche con l'area selezionata: è la vista da cui è saltato fuori.
    expect(
      (await list(managerCookie, true, "DEV")).items.map((t: { id: string }) => t.id),
    ).not.toContain(taskId);
    const inProject = await app.inject({
      method: "GET",
      url: `/api/tasks?projectId=${projectId}`,
      headers: { cookie: managerCookie },
    });
    expect(inProject.json().items.map((t: { id: string }) => t.id)).toContain(taskId);
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: managerCookie },
      payload: { isArchived: false },
    });
  });
});

describe("scadenzario: i propri, e quelli dell'area che si governa", () => {
  it("senza scope si vedono solo i propri; da manager d'area anche quelli dell'area governata", async () => {
    // Il modello chiesto (11/08/2026): un utente normale vede i propri record e
    // quelli che supervisiona; i record altrui li vede chi governa quell'area
    // (manager di gruppo) o l'admin. Prima la regola del manager esisteva solo
    // per-record: il task si poteva aprire ma non compariva in nessun elenco.
    const outsider = await prisma.user.findUniqueOrThrow({
      where: { email: "outsider@test.local" },
    });
    // L'area di un task è quella del suo stato: qui uno amministrativo (in
    // questo file `openStatusId` è di sviluppo, che serve ai progetti).
    const adminStatus = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
      orderBy: { order: "asc" },
    });
    const suo = await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Adempimento dell'outsider",
        statusId: adminStatus.id,
        creatorId: outsider.id,
        assigneeId: outsider.id,
      },
    });

    const vede = async (cookie: string) => {
      const response = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie } });
      return response
        .json()
        .items.map((t: { id: string }) => t.id)
        .includes(suo.id);
    };

    // Il viewer non c'entra niente con quel task e non ha scope: non lo vede.
    expect(await vede(viewerCookie)).toBe(false);

    // Lo stesso viewer, fatto manager del gruppo che governa l'area
    // amministrativa, ora lo trova in elenco — e lo può aprire.
    const gruppo = await prisma.group.create({
      data: { name: "Governo amministrativo", managedArea: "ADMIN" },
    });
    await prisma.groupMember.create({
      data: { groupId: gruppo.id, userId: viewerId, isManager: true },
    });
    expect(await vede(viewerCookie)).toBe(true);
    const dettaglio = await app.inject({
      method: "GET",
      url: `/api/tasks/${suo.id}`,
      headers: { cookie: viewerCookie },
    });
    expect(dettaglio.statusCode).toBe(200);

    // Ma solo la SUA area: un task di sviluppo resta fuori.
    const devStatus = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: false },
      orderBy: { order: "asc" },
    });
    const tecnico = await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Roba tecnica di un altro",
        statusId: devStatus.id,
        creatorId: outsider.id,
        assigneeId: outsider.id,
      },
    });
    const elenco = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie: viewerCookie },
    });
    expect(elenco.json().items.map((t: { id: string }) => t.id)).not.toContain(tecnico.id);

    // Tolto il governo dell'area, torna invisibile anche l'amministrativo.
    await prisma.group.delete({ where: { id: gruppo.id } });
    expect(await vede(viewerCookie)).toBe(false);
  });
});

describe("visibilità ADMIN_TASKS", () => {
  it("scadenzario: senza scope si vedono solo i propri task; con scope tutto", async () => {
    // Un task ADMIN assegnato all'outsider e uno assegnato al manager.
    const outsider = await prisma.user.findUniqueOrThrow({
      where: { email: "outsider@test.local" },
    });
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Task dell'outsider",
        statusId: openStatusId,
        creatorId: outsider.id,
        assigneeId: outsider.id,
      },
    });
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Task del manager",
        statusId: openStatusId,
        creatorId: managerId,
        assigneeId: managerId,
      },
    });

    // Outsider (nessuno scope): 200 ma vede solo il proprio task.
    const outsiderList = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie: outsiderCookie },
    });
    expect(outsiderList.statusCode).toBe(200);
    const outsiderTitles = outsiderList.json().items.map((t: { title: string }) => t.title);
    expect(outsiderTitles).toContain("Task dell'outsider");
    expect(outsiderTitles).not.toContain("Task del manager");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: outsiderCookie },
    });
    expect(me.json().canSeeAdminTasks).toBe(false);

    // Manager (scope ADMIN_TASKS): vede tutto lo scadenzario.
    const managerList = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
    });
    expect(managerList.statusCode).toBe(200);
    const managerTitles = managerList.json().items.map((t: { title: string }) => t.title);
    expect(managerTitles).toContain("Task dell'outsider");
    expect(managerTitles).toContain("Task del manager");
  });

  it("task personale: owner=creatore, non assegnato ad altri, e auto-presa in carico", async () => {
    const outsider = await prisma.user.findUniqueOrThrow({
      where: { email: "outsider@test.local" },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: outsiderCookie },
      // Prova ad assegnarlo ad altri: senza scope viene ignorato (resta libero).
      payload: { title: "Promemoria personale", assigneeId: managerId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().assignee).toBeNull();
    expect(created.json().creator.id).toBe(outsider.id);
    expect(created.json().kind).toBe("ADMIN");
    const taskId = created.json().id;

    // Compare nel proprio scadenzario (visibile perché ne è il creatore).
    const list = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie: outsiderCookie },
    });
    expect(list.json().items.map((t: { title: string }) => t.title)).toContain(
      "Promemoria personale",
    );

    // Cambiando stato lo prende in carico automaticamente. È un task dello
    // scadenzario: gli stati sono quelli amministrativi, non quelli di progetto.
    const adminClosed = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: true },
      orderBy: { order: "asc" },
    });
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: outsiderCookie },
      payload: { statusId: adminClosed.id },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().assignee.id).toBe(outsider.id);
  });
});

describe("progetti e permessi", () => {
  it("creator becomes MANAGER; non-members get 404", async () => {
    const projectId = await createProject();
    const list = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: managerCookie },
    });
    const project = list.json().find((p: { id: string }) => p.id === projectId);
    expect(project.myRole).toBe("MANAGER");

    const outsider = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      headers: { cookie: outsiderCookie },
    });
    expect(outsider.statusCode).toBe(404);
    const outsiderTasks = await app.inject({
      method: "GET",
      url: `/api/tasks?projectId=${projectId}`,
      headers: { cookie: outsiderCookie },
    });
    expect(outsiderTasks.statusCode).toBe(404);
  });

  it("links a company on create, unlinks on patch, rejects unknown ids", async () => {
    const company = await prisma.company.create({
      data: { name: `Cliente ${Math.floor(Math.random() * 1e9)}` },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: managerCookie },
      payload: {
        name: `Progetto con azienda ${Math.floor(Math.random() * 1e9)}`,
        companyId: company.id,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().company).toMatchObject({ id: company.id, name: company.name });
    const projectId = created.json().id;

    const unlinked = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: managerCookie },
      payload: { companyId: null },
    });
    expect(unlinked.json().company).toBeNull();

    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: managerCookie },
      payload: { companyId: "id-inesistente" },
    });
    expect(invalid.statusCode).toBe(404);
  });

  it("edits name/description and exposes myNextDueDate for the current user", async () => {
    const projectId = await createProject();

    // Modifica del record (nome + descrizione).
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: managerCookie },
      payload: { name: "Nome modificato", description: "Nuova descrizione" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().name).toBe("Nome modificato");
    expect(edited.json().description).toBe("Nuova descrizione");

    // Un mio task con scadenza → myNextDueDate ne riflette la data.
    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: {
        title: "Task con scadenza",
        projectId,
        assigneeId: managerId,
        dueDate: "2027-03-15",
      },
    });
    const list = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: managerCookie },
    });
    const project = list.json().find((p: { id: string }) => p.id === projectId);
    expect(project.myNextDueDate).toBe("2027-03-15");

    // Il viewer (nessun task assegnato) non ha una propria scadenza.
    const viewerList = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: viewerCookie },
    });
    const viewerProject = viewerList.json().find((p: { id: string }) => p.id === projectId);
    expect(viewerProject.myNextDueDate).toBeNull();
  });

  it("la ricerca progetti funziona anche per un membro non privilegiato", async () => {
    // Il difetto: per chi non è admin/scope Progetti lo spread della visibilità
    // cancellava la chiave OR della ricerca, e il filtro spariva.
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: "viewer@test.local" } });
    const pieno = await prisma.project.create({
      data: {
        name: "Configuratore aziendale kw-alfa",
        members: { create: { userId: viewer.id, role: "VIEWER" } },
      },
    });
    await prisma.project.create({
      data: {
        name: "Portale clienti kw-beta",
        members: { create: { userId: viewer.id, role: "VIEWER" } },
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/projects?q=kw-alfa",
      headers: { cookie: viewerCookie },
    });
    expect(res.statusCode).toBe(200);
    const nomi = res.json().map((p: { name: string }) => p.name) as string[];
    expect(nomi).toContain("Configuratore aziendale kw-alfa");
    // La ricerca restringe: l'altro progetto del viewer non deve comparire.
    expect(nomi).not.toContain("Portale clienti kw-beta");
    void pieno;
  });

  it("l'elenco lascia fuori il progetto dove non sei membro e non hai più lavoro aperto", async () => {
    /**
     * L'elenco Progetti è la scrivania, non l'archivio: un progetto chiuso
     * dietro le spalle ci restava per sempre con la spunta "Non sei membro"
     * (18/08/2026). Aprirlo si può ancora — il task chiuso resta tuo — quindi
     * la ricerca e la freccia dal task continuano a funzionare.
     */
    const projectId = await createProject();
    const estraneo = await prisma.user.create({
      data: {
        email: "passato@test.local",
        name: "Chi Ci Lavorava",
        passwordHash: await hashPassword("passato1234"),
      },
    });
    const cookie = await loginCookie("passato@test.local", "passato1234");
    const aperto = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: false },
    });
    const chiuso = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: true },
    });
    const task = await prisma.task.create({
      data: {
        kind: "PROJECT",
        title: "Lavoro finito",
        projectId,
        statusId: aperto.id,
        creatorId: estraneo.id,
        assigneeId: estraneo.id,
      },
    });

    const conLavoro = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie },
    });
    expect((conLavoro.json() as Array<{ id: string }>).map((p) => p.id)).toContain(projectId);

    // Chiuso il suo unico task, il progetto esce dall'elenco…
    await prisma.task.update({ where: { id: task.id }, data: { statusId: chiuso.id } });
    const dopo = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie } });
    expect((dopo.json() as Array<{ id: string }>).map((p) => p.id)).not.toContain(projectId);

    // …ma resta apribile: il task chiuso è ancora suo.
    const dettaglio = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      headers: { cookie },
    });
    expect(dettaglio.statusCode).toBe(200);
  });

  it("VIEWER can read but not edit project tasks", async () => {
    const projectId = await createProject();
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Task progetto", projectId },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id;

    const viewerRead = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: viewerCookie },
    });
    expect(viewerRead.statusCode).toBe(200);

    const viewerEdit = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: viewerCookie },
      payload: { title: "Modificato" },
    });
    expect(viewerEdit.statusCode).toBe(403);

    const viewerCreate = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: viewerCookie },
      payload: { title: "Nuovo", projectId },
    });
    expect(viewerCreate.statusCode).toBe(403);
  });

  it("subtasks are limited to one level", async () => {
    const projectId = await createProject();
    const parent = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Padre", projectId },
    });
    const sub = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Figlio", projectId, parentTaskId: parent.json().id },
    });
    expect(sub.statusCode).toBe(201);

    const nested = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Nipote", projectId, parentTaskId: sub.json().id },
    });
    expect(nested.statusCode).toBe(400);
  });

  it("closing a parent with open subtasks requires confirmation", async () => {
    const projectId = await createProject();
    const parent = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Padre con figli", projectId },
    });
    const parentId = parent.json().id;
    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Subtask aperto", projectId, parentTaskId: parentId },
    });

    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${parentId}`,
      headers: { cookie: managerCookie },
      payload: { statusId: closedStatusId },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("SUBTASKS_OPEN");

    const confirmed = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${parentId}`,
      headers: { cookie: managerCookie },
      payload: { statusId: closedStatusId, confirmSubtasks: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().closedAt).not.toBeNull();
  });
});

describe("notifiche", () => {
  // Il dialogo "Nuovo task di progetto" permette di scegliere subito assegnatario
  // e supervisore: qui si verifica che il server li applichi davvero entrambi,
  // anche quando sono persone diverse da chi crea.
  it("crea un task di progetto con assegnatario e supervisore distinti", async () => {
    const projectId = await createProject();
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: {
        title: "Da lavorare in due",
        projectId,
        assigneeId: viewerId,
        supervisorId: managerId,
      },
    });
    expect(created.statusCode).toBe(201);
    const detail = created.json();
    expect(detail.assignee.id).toBe(viewerId);
    expect(detail.supervisor.id).toBe(managerId);

    // L'assegnatario riceve la notifica; il supervisore seguirà i cambi di stato.
    const notified = await prisma.notification.findMany({ where: { userId: viewerId } });
    const assegnata = notified.find((n) => n.type === "task_assigned");
    expect(assegnata).toBeDefined();

    // Il riferimento è completo: id **e** tipo del task. Senza il tipo il click
    // apriva comunque qualcosa (il ripiego è il task), quindi il difetto non si
    // vedeva finché il riferimento non era un'offerta o un ticket.
    const payload = JSON.parse(assegnata!.payload) as { taskId?: string; taskKind?: string };
    expect(payload.taskId).toBe(detail.id);
    expect(payload.taskKind).toBe(TaskKind.PROJECT);
  });

  it("assignment and supervised status change create notifications", async () => {
    const projectId = await createProject();
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: {
        title: "Notificami",
        projectId,
        assigneeId: viewerId,
        supervisorId: viewerId,
      },
    });
    const taskId = created.json().id;

    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: managerCookie },
      payload: { statusId: closedStatusId, confirmSubtasks: true },
    });

    const viewerNotifications = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { cookie: viewerCookie },
    });
    const types = viewerNotifications.json().notifications.map((n: { type: string }) => n.type);
    expect(types).toContain(NotificationType.TASK_ASSIGNED);
    expect(types).toContain(NotificationType.SUPERVISED_STATUS_CHANGED);
    expect(viewerNotifications.json().unreadCount).toBeGreaterThan(0);
  });

  it("comments notify assignee and mentions, respecting preferences", async () => {
    const projectId = await createProject();
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Commentami", projectId, assigneeId: viewerId },
    });
    const taskId = created.json().id;

    // Commento con menzione: il viewer riceve MENTION (non doppio TASK_COMMENT).
    await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/comments`,
      headers: { cookie: managerCookie },
      payload: { body: "Ciao @Vito Viewer, puoi guardare?" },
    });

    let list = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { cookie: viewerCookie },
    });
    const mentionCount = list
      .json()
      .notifications.filter(
        (n: { type: string; text: string }) =>
          n.type === NotificationType.MENTION && n.text.includes("Commentami"),
      ).length;
    expect(mentionCount).toBe(1);

    // Disattiva i commenti nelle preferenze → nessuna nuova notifica TASK_COMMENT.
    await app.inject({
      method: "PUT",
      url: "/api/notification-preferences",
      headers: { cookie: viewerCookie },
      payload: { type: NotificationType.TASK_COMMENT, enabled: false },
    });
    await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/comments`,
      headers: { cookie: managerCookie },
      payload: { body: "Commento senza menzione" },
    });
    list = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { cookie: viewerCookie },
    });
    const commentCount = list
      .json()
      .notifications.filter(
        (n: { type: string; text: string }) =>
          n.type === NotificationType.TASK_COMMENT && n.text.includes("Commentami"),
      ).length;
    expect(commentCount).toBe(0);
  });

  it("read and read-all update unread count", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { cookie: viewerCookie },
    });
    expect(before.json().unreadCount).toBeGreaterThan(0);

    await app.inject({
      method: "POST",
      url: "/api/notifications/read-all",
      headers: { cookie: viewerCookie },
    });
    const after = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { cookie: viewerCookie },
    });
    expect(after.json().unreadCount).toBe(0);
  });

  it("due digest sends one notification per user per day", async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Task scaduto",
        statusId: openStatusId,
        creatorId: managerId,
        assigneeId: managerId,
        dueDate: yesterday,
      },
    });

    const first = await sendDueDigests();
    expect(first).toBeGreaterThanOrEqual(1);
    const second = await sendDueDigests();
    expect(second).toBe(0); // già inviato oggi

    const list = await app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: { cookie: managerCookie },
    });
    const digest = list
      .json()
      .notifications.find((n: { type: string }) => n.type === NotificationType.DUE_DIGEST);
    expect(digest.text).toContain("in ritardo");
  });

  it("chi entra in un progetto lo sa, e sa in che ruolo", async () => {
    const nuovo = await prisma.user.create({
      // locale dichiarato: il test legge l'avviso in italiano (vedi beforeAll).
      data: { email: "nuovo@test.local", name: "Nino Nuovo", role: UserRole.MEMBER, locale: "it" },
    });
    const projectId = await createProject();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/members`,
      headers: { cookie: managerCookie },
      payload: {
        members: [
          { userId: managerId, role: "MANAGER" },
          { userId: nuovo.id, role: "EDITOR" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const avviso = await prisma.notification.findFirst({
      where: { userId: nuovo.id, type: NotificationType.PROJECT_MEMBER },
    });
    expect(avviso).not.toBeNull();
    // Il ruolo è nel testo: "Editor" e "Visualizzatore" non permettono le stesse
    // cose, e chi riceve l'avviso deve capire cosa può fare.
    expect(JSON.parse(avviso!.payload).text).toContain("come Editor");

    // Chi c'era già non riceve niente: per lui non è successo nulla.
    const perIlManager = await prisma.notification.count({
      where: { userId: managerId, type: NotificationType.PROJECT_MEMBER },
    });
    expect(perIlManager).toBe(0);
  });

  it("chi viene messo a seguire un task lo sa subito", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Da seguire", supervisorId: viewerId },
    });
    expect(created.statusCode).toBe(201);
    const avviso = await prisma.notification.findFirst({
      where: { userId: viewerId, type: NotificationType.SUPERVISED_STATUS_CHANGED },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.parse(avviso!.payload).text).toContain("referente");
  });

  it("il riepilogo scadenze arriva anche a chi supervisiona, non solo a chi esegue", async () => {
    // Chi segue un task deve accorgersi che è in ritardo senza dover entrare
    // nell'applicazione: prima il supervisore restava fuori dal riepilogo.
    const domani = new Date();
    domani.setUTCDate(domani.getUTCDate() + 1);
    domani.setUTCHours(0, 0, 0, 0);
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Con supervisore",
        statusId: openStatusId,
        creatorId: managerId,
        assigneeId: viewerId,
        supervisorId: managerId,
        dueDate: domani,
      },
    });

    // Il riepilogo di oggi è già partito nel test precedente: si guarda domani.
    const domaniMattina = new Date();
    domaniMattina.setUTCDate(domaniMattina.getUTCDate() + 1);
    domaniMattina.setUTCHours(7, 0, 0, 0);
    await sendDueDigests(domaniMattina);

    for (const userId of [viewerId, managerId]) {
      const digest = await prisma.notification.findFirst({
        where: { userId, type: NotificationType.DUE_DIGEST },
        orderBy: { createdAt: "desc" },
      });
      expect(digest, `manca il riepilogo per ${userId}`).not.toBeNull();
    }
  });
});

describe("aspetto e ordine dei progetti", () => {
  it("salva colore e icona, e rifiuta valori fuori palette", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: managerCookie },
      payload: { name: "Colorato", color: "blue", icon: "Rocket" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().color).toBe("blue");
    expect(ok.json().icon).toBe("Rocket");

    const bad = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: managerCookie },
      payload: { name: "X", color: "turchese-fluo" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("un admin gestisce il progetto anche se è solo EDITOR come membro", async () => {
    const projectId = await createProject(); // manager=MANAGER, viewer=VIEWER
    // Aggiungi l'admin come EDITOR (ruolo minore): la membership non deve declassarlo.
    await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/members`,
      headers: { cookie: managerCookie },
      payload: {
        members: [
          { userId: managerId, role: "MANAGER" },
          { userId: adminId, role: "EDITOR" },
        ],
      },
    });
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: adminCookie },
      payload: { color: "blue", icon: "Rocket" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().color).toBe("blue");
    expect(patched.json().icon).toBe("Rocket");
  });

  it("espone i campi per l'ordinamento consigliato", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: managerCookie },
    });
    const project = list.json()[0];
    expect(project).toHaveProperty("myOpenTaskCount");
    expect(project).toHaveProperty("myLastAssignedAt");
    expect(project).toHaveProperty("myLastActivityAt");
  });

  it("entrare in uno stato «attività amministrativa» avvisa chi deve fatturare", async () => {
    // Il flusso chiesto: i manager sviluppatori marcano uno stato DEV (es.
    // "Rilasciato") come tappa da fatturare; quando "Consegna beta" ci entra,
    // il referente amministrativo lo sa e emette la fattura secondo l'offerta.
    const projectId = await createProject();
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: "viewer@test.local" } });
    const dev = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: false },
      orderBy: { order: "asc" },
    });
    const consegnato = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: true },
      orderBy: { order: "asc" },
    });
    await prisma.taskStatus.update({
      where: { id: consegnato.id },
      data: { isBillingMilestone: true },
    });
    // La fattura discende da un'offerta: il progetto è nato da un'offerta vinta
    // (Task.relatedProjectId sul deal). Senza questo legame la tappa non deve
    // avvisare nessuno — non c'è niente da fatturare.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const salesStatus = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "SALES" },
      orderBy: { order: "asc" },
    });
    await prisma.task.create({
      data: {
        kind: "DEAL",
        title: "Offerta del progetto",
        statusId: salesStatus.id,
        creatorId: admin.id,
        relatedProjectId: projectId,
      },
    });

    const task = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Consegna beta", projectId, statusId: dev.id, supervisorId: viewer.id },
    });
    expect(task.statusCode).toBe(201);

    const prima = await prisma.notification.count({
      where: { userId: viewer.id, type: "billing_milestone" },
    });
    const chiuso = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.json().id}`,
      headers: { cookie: managerCookie },
      payload: { statusId: consegnato.id, confirmSubtasks: true },
    });
    expect(chiuso.statusCode).toBe(200);

    const avvisi = await prisma.notification.findMany({
      where: { userId: viewer.id, type: "billing_milestone" },
      orderBy: { createdAt: "desc" },
    });
    expect(avvisi.length).toBe(prima + 1);
    expect(JSON.parse(avvisi[0]!.payload).text).toContain("Da fatturare");
    // E riceve anche il cambio di stato che supervisiona: sono due cose diverse
    // (una è la cronaca, l'altra è "c'è una fattura da fare").
    const supervisione = await prisma.notification.count({
      where: { userId: viewer.id, type: "supervised_status_changed" },
    });
    expect(supervisione).toBeGreaterThan(0);

    // E resta scritto nello storico del task: una notifica si legge e sparisce,
    // ma chi apre il task settimane dopo deve vedere quando è scattata la tappa
    // e chi l'ha fatta scattare.
    const storico = await prisma.activityLog.findMany({
      where: { taskId: task.json().id, action: "billing_milestone" },
    });
    expect(storico).toHaveLength(1);
    expect(JSON.parse(storico[0]!.payload!).status).toBe(consegnato.name);

    // Ripassando per lo stesso stato non si avvisa due volte.
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.json().id}`,
      headers: { cookie: managerCookie },
      payload: { statusId: dev.id },
    });
    await prisma.taskStatus.update({
      where: { id: consegnato.id },
      data: { isBillingMilestone: false },
    });
  });

  it("la tappa da fatturare NON avvisa se il task non discende da un'offerta", async () => {
    // Il caso dell'11/08/2026: "Rilasciato" marcato tappa amministrativa e "Da
    // fatturare" partito per un task interno, senza alcuna offerta di mezzo.
    // Niente offerta → niente fattura → niente notifica (la supervisione sì:
    // quella è la cronaca, non "c'è una fattura da fare").
    const projectId = await createProject(); // nessun deal punta a questo progetto
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: "viewer@test.local" } });
    const dev = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: false },
      orderBy: { order: "asc" },
    });
    const consegnato = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "DEV", isClosed: true },
      orderBy: { order: "asc" },
    });
    await prisma.taskStatus.update({
      where: { id: consegnato.id },
      data: { isBillingMilestone: true },
    });

    const task = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: {
        title: "Refactoring interno",
        projectId,
        statusId: dev.id,
        supervisorId: viewer.id,
      },
    });
    const prima = await prisma.notification.count({
      where: { userId: viewer.id, type: "billing_milestone" },
    });
    const chiuso = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.json().id}`,
      headers: { cookie: managerCookie },
      payload: { statusId: consegnato.id, confirmSubtasks: true },
    });
    expect(chiuso.statusCode).toBe(200);

    const dopo = await prisma.notification.count({
      where: { userId: viewer.id, type: "billing_milestone" },
    });
    expect(dopo).toBe(prima); // nessun "Da fatturare"
    await prisma.taskStatus.update({
      where: { id: consegnato.id },
      data: { isBillingMilestone: false },
    });
  });

  it("chi fa da referente su un task vede il progetto e i suoi task, non gli altri", async () => {
    // Il caso segnalato: "Consegna beta" in un progetto di sviluppo, con
    // un'amministrativa come supervisore che non è nella squadra. La regola
    // per-record la autorizzava già, ma il progetto non compariva da nessuna
    // parte e la pagina rispondeva 404: il task era irraggiungibile.
    const projectId = await createProject();
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: "viewer@test.local" } });
    await prisma.projectMember.deleteMany({ where: { projectId, userId: viewer.id } });

    const mio = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Consegna beta", projectId, supervisorId: viewer.id },
    });
    expect(mio.statusCode).toBe(201);
    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Lavoro di altri", projectId },
    });

    // Il progetto compare nel suo elenco…
    const elenco = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: viewerCookie },
    });
    const suo = elenco.json().find((p: { id: string }) => p.id === projectId);
    expect(suo).toBeTruthy();
    expect(suo.myRole).toBeNull(); // non è membro, e la card lo dice

    // …la pagina si apre…
    const dettaglio = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      headers: { cookie: viewerCookie },
    });
    expect(dettaglio.statusCode).toBe(200);

    // …e dentro vede il suo task, non quelli della squadra.
    const task = await app.inject({
      method: "GET",
      url: `/api/tasks?projectId=${projectId}`,
      headers: { cookie: viewerCookie },
    });
    const titoli = task.json().items.map((t: { title: string }) => t.title);
    expect(titoli).toContain("Consegna beta");
    expect(titoli).not.toContain("Lavoro di altri");
  });

  it("un progetto si lega a un'offerta anche a mano, e il legame resta uno solo", async () => {
    const stage = await prisma.dealStage.create({
      data: { name: `Fase ${Math.random()}`, color: "#000000", order: 90 },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const offerta = async (title: string) =>
      (
        await prisma.task.create({
          data: { kind: "DEAL", title, creatorId: admin.id, dealStageId: stage.id },
        })
      ).id;
    const prima = await offerta("Offerta di partenza");
    const seconda = await offerta("Offerta successiva");

    // Il manager sviluppatori crea il progetto e sceglie l'offerta.
    const creato = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: adminCookie },
      payload: { name: "Commessa a mano", dealId: prima },
    });
    expect(creato.statusCode).toBe(201);
    expect(creato.json().deal).toMatchObject({ id: prima, title: "Offerta di partenza" });

    // Ricollegando a un'altra offerta la prima si stacca: un progetto dichiara
    // una provenienza sola.
    const projectId = creato.json().id;
    const spostato = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: adminCookie },
      payload: { dealId: seconda },
    });
    expect(spostato.json().deal).toMatchObject({ id: seconda });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: prima } })).relatedProjectId,
    ).toBeNull();

    // E si può staccare del tutto.
    const staccato = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}`,
      headers: { cookie: adminCookie },
      payload: { dealId: null },
    });
    expect(staccato.json().deal).toBeNull();
  });

  it("cerca per nome e, su richiesta, anche nei titoli dei task", async () => {
    const projectId = await createProject();
    await prisma.project.update({
      where: { id: projectId },
      data: { name: "Configuratore Stadio" },
    });
    const altro = await createProject();
    await prisma.project.update({ where: { id: altro }, data: { name: "Manutenzioni" } });
    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Rivedere il configuratore", projectId: altro },
    });

    const cerca = async (query: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/projects?${query}`,
        headers: { cookie: managerCookie },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as Array<{ name: string }>).map((p) => p.name);
    };

    // Solo i nomi: "Manutenzioni" non c'entra, anche se dentro ha quel task.
    expect(await cerca("q=configuratore")).toEqual(["Configuratore Stadio"]);
    // Con la spunta si guarda anche dentro: il progetto salta fuori dal task.
    const conTask = await cerca("q=configuratore&searchTasks=true");
    expect(conTask).toContain("Configuratore Stadio");
    expect(conTask).toContain("Manutenzioni");
  });

  it("lavorare su un task fa risultare il progetto come 'ci sto lavorando'", async () => {
    // Il segnale che mancava: le ore, i commenti e le modifiche dicono dove si
    // sta lavorando; l'assegnazione da sola no (spesso i task sono di altri).
    const projectId = await createProject();
    const creato = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: managerCookie },
      payload: { title: "Da lavorare", projectId },
    });
    expect(creato.statusCode).toBe(201);

    const mio = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: managerCookie },
    });
    // Creare il task è già un'attività registrata: il progetto risulta lavorato.
    const prima = mio.json().find((p: { id: string }) => p.id === projectId);
    expect(prima.myLastActivityAt).not.toBeNull();

    const commento = await app.inject({
      method: "POST",
      url: `/api/tasks/${creato.json().id}/comments`,
      headers: { cookie: managerCookie },
      payload: { body: "Ci sto lavorando adesso" },
    });
    expect(commento.statusCode).toBe(201);

    const dopo = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: managerCookie },
    });
    const adesso = dopo.json().find((p: { id: string }) => p.id === projectId);
    expect(adesso.myLastActivityAt).not.toBeNull();

    // È personale: il lavoro di un collega non muove il progetto nel mio elenco.
    const altrui = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: adminCookie },
    });
    const perAdmin = altrui.json().find((p: { id: string }) => p.id === projectId);
    expect(perAdmin.myLastActivityAt).toBeNull();
  });

  it("memorizza e azzera l'ordine manuale (per-utente)", async () => {
    const empty = await app.inject({
      method: "GET",
      url: "/api/profile/project-order",
      headers: { cookie: managerCookie },
    });
    expect(empty.json().order).toEqual([]);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/profile/project-order",
      headers: { cookie: managerCookie },
      payload: { order: ["p1", "p2", "p3"] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().order).toEqual(["p1", "p2", "p3"]);

    const reread = await app.inject({
      method: "GET",
      url: "/api/profile/project-order",
      headers: { cookie: managerCookie },
    });
    expect(reread.json().order).toEqual(["p1", "p2", "p3"]);

    // Ordine di un altro utente: indipendente.
    const other = await app.inject({
      method: "GET",
      url: "/api/profile/project-order",
      headers: { cookie: viewerCookie },
    });
    expect(other.json().order).toEqual([]);

    // Array vuoto = ritorno all'ordine automatico.
    await app.inject({
      method: "PUT",
      url: "/api/profile/project-order",
      headers: { cookie: managerCookie },
      payload: { order: [] },
    });
    const cleared = await app.inject({
      method: "GET",
      url: "/api/profile/project-order",
      headers: { cookie: managerCookie },
    });
    expect(cleared.json().order).toEqual([]);
  });
});

describe("ordine colonne kanban per-utente", () => {
  it("salva, rilegge e azzera l'ordine colonne per chiave", async () => {
    const empty = await app.inject({
      method: "GET",
      url: "/api/profile/column-order",
      headers: { cookie: managerCookie },
    });
    expect(empty.json().orders).toEqual({});

    const saved = await app.inject({
      method: "PUT",
      url: "/api/profile/column-order",
      headers: { cookie: managerCookie },
      payload: { key: "task:ADMIN", order: ["s1", "s2", "s3"] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().orders["task:ADMIN"]).toEqual(["s1", "s2", "s3"]);

    const reread = await app.inject({
      method: "GET",
      url: "/api/profile/column-order",
      headers: { cookie: managerCookie },
    });
    expect(reread.json().orders["task:ADMIN"]).toEqual(["s1", "s2", "s3"]);

    // Array vuoto = ripristina l'ordine standard di quella bacheca.
    await app.inject({
      method: "PUT",
      url: "/api/profile/column-order",
      headers: { cookie: managerCookie },
      payload: { key: "task:ADMIN", order: [] },
    });
    const cleared = await app.inject({
      method: "GET",
      url: "/api/profile/column-order",
      headers: { cookie: managerCookie },
    });
    expect(cleared.json().orders).toEqual({});
  });
});
