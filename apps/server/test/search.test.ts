import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ProjectRole, TaskKind, UserRole } from "@kancrm/shared";

// Database usa e getta del file di test, migrato con le stesse migrazioni della
// produzione (come negli altri file: l'ambiente si prepara PRIMA di importare
// l'app, che legge DATABASE_PATH al primo import).
prepareTestDb("search");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * La ricerca globale è il punto in cui un buco di permessi fa più danno: una
 * parola azzeccata basterebbe a leggere titoli di offerte, nomi di file e righe
 * di chat mai autorizzati. Qui il perimetro si prova dai due lati: chi PUÒ
 * vedere trova, chi NON PUÒ non trova — sugli stessi identici record.
 */

let app: App;
let adminCookie: string;
let esternaCookie: string; // membro senza gruppi: nessuno scope di modulo

let progettoRiservatoId: string;

const MARCA = "Riservatissimo";

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return response.headers["set-cookie"]!.toString().split(";")[0]!;
}

const cerca = async (cookie: string, q = MARCA) => {
  const response = await app.inject({
    method: "GET",
    url: `/api/search?q=${encodeURIComponent(q)}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Array<{ type: string; id: string; title: string; subtitle: string }>;
};

beforeAll(async () => {
  const [admin] = await Promise.all([
    prisma.user.create({
      data: {
        email: "admin@test.local",
        name: "Admin",
        role: UserRole.ADMIN,
        adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
        passwordHash: await hashPassword("admin1234"),
      },
    }),
    prisma.user.create({
      data: {
        email: "esterna@test.local",
        name: "Collaboratrice Esterna",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("esterna123"),
      },
    }),
  ]);

  const statoAdmin = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
  });
  // Le fasi pipeline arrivano dal seed, non dalle migrazioni: qui se ne crea una.
  const fase = await prisma.dealStage.create({
    data: { name: "Trattativa", color: "#888", order: 1 },
  });

  // Un mondo intero marcato con la stessa parola, tutto fuori dalla portata
  // dell'utente senza permessi.
  const progetto = await prisma.project.create({
    data: {
      name: `Progetto ${MARCA}`,
      members: { create: [{ userId: admin.id, role: ProjectRole.MANAGER }] },
    },
  });
  progettoRiservatoId = progetto.id;
  const taskProgetto = await prisma.task.create({
    data: {
      kind: TaskKind.PROJECT,
      title: `Rilascio ${MARCA}`,
      statusId: statoAdmin.id,
      creatorId: admin.id,
      projectId: progetto.id,
    },
  });
  await prisma.task.create({
    data: {
      kind: TaskKind.ADMIN,
      title: `Scadenza ${MARCA}`,
      statusId: statoAdmin.id,
      creatorId: admin.id,
    },
  });
  await prisma.task.create({
    data: {
      kind: TaskKind.DEAL,
      title: `Offerta ${MARCA} 250k`,
      statusId: statoAdmin.id,
      dealStageId: fase.id,
      creatorId: admin.id,
    },
  });
  // Il messaggio sta su un task il cui TITOLO non contiene la parola: così si
  // prova che l'ha trovato la chat, non il titolo (che avrebbe la precedenza).
  const taskSenzaMarca = await prisma.task.create({
    data: {
      kind: TaskKind.PROJECT,
      title: "Verbale riunione",
      statusId: statoAdmin.id,
      creatorId: admin.id,
      projectId: progetto.id,
    },
  });
  await prisma.comment.create({
    data: { taskId: taskSenzaMarca.id, authorId: admin.id, body: `Il margine ${MARCA} è al 40%` },
  });
  await prisma.attachment.create({
    data: {
      type: "FILE",
      name: `contratto-${MARCA}.pdf`,
      path: "x/y.pdf",
      uploadedById: admin.id,
      tasks: { create: [{ taskId: taskProgetto.id }] },
    },
  });
  await prisma.recurrenceTemplate.create({
    data: {
      title: `Canone ${MARCA}`,
      rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
      dtstart: new Date("2026-01-15T00:00:00.000Z"),
      creatorId: admin.id,
    },
  });
  // Un task nel cestino: non deve uscire nemmeno all'admin.
  await prisma.task.create({
    data: {
      kind: TaskKind.ADMIN,
      title: `Cestinato ${MARCA}`,
      statusId: statoAdmin.id,
      creatorId: admin.id,
      deletedAt: new Date(),
    },
  });

  app = await buildApp();
  adminCookie = await loginCookie("admin@test.local", "admin1234");
  esternaCookie = await loginCookie("esterna@test.local", "esterna123");
});

afterAll(async () => {
  await app.close();
});

describe("ricerca globale — copertura", () => {
  it("l'admin trova tutto: task, offerta, progetto, ricorrenza, messaggio, allegato", async () => {
    const risultati = await cerca(adminCookie);
    const tipi = new Set(risultati.map((r) => r.type));
    for (const tipo of ["task", "deal", "project", "recurrence", "comment", "attachment"]) {
      expect(tipi, `manca il tipo ${tipo}`).toContain(tipo);
    }
    // Il cestino non esiste, nemmeno per l'admin: si ripristina dal Cestino.
    expect(risultati.map((r) => r.title)).not.toContain(`Cestinato ${MARCA}`);
  });

  it("il messaggio arriva con il contesto del suo task", async () => {
    const risultati = await cerca(adminCookie);
    const messaggio = risultati.find((r) => r.type === "comment");
    expect(messaggio?.title).toBe("Verbale riunione");
    expect(messaggio?.subtitle).toContain("margine");
  });

  it("un task trovato per titolo non si sdoppia per i suoi contenuti", async () => {
    // Su "Rilascio Riservatissimo" c'è anche un commento con la parola: la voce
    // resta una sola, quella del task.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const task = await prisma.task.findFirstOrThrow({ where: { title: `Rilascio ${MARCA}` } });
    const commento = await prisma.comment.create({
      data: { taskId: task.id, authorId: admin.id, body: `Nota su ${MARCA}` },
    });
    const risultati = await cerca(adminCookie);
    expect(
      risultati.filter(
        (r) => r.title === `Rilascio ${MARCA}` && ["task", "comment"].includes(r.type),
      ),
    ).toHaveLength(1);
    await prisma.comment.delete({ where: { id: commento.id } });
  });
});

describe("ricerca globale — autorizzazione", () => {
  it("chi non ha permessi non trova NIENTE degli stessi record", async () => {
    // Stessa parola, stesso database: per lei il mondo marcato non esiste.
    expect(await cerca(esternaCookie)).toEqual([]);
  });

  it("diventando membro del progetto, trova il suo mondo e non il resto", async () => {
    const esterna = await prisma.user.findUniqueOrThrow({
      where: { email: "esterna@test.local" },
    });
    await prisma.projectMember.create({
      data: { projectId: progettoRiservatoId, userId: esterna.id, role: ProjectRole.VIEWER },
    });
    const risultati = await cerca(esternaCookie);
    const titoli = risultati.map((r) => r.title);
    expect(titoli).toContain(`Rilascio ${MARCA}`); // il task del SUO progetto
    expect(titoli).toContain(`contratto-${MARCA}.pdf`); // e il suo allegato
    expect(titoli).not.toContain(`Offerta ${MARCA} 250k`); // le offerte no
    expect(titoli).not.toContain(`Scadenza ${MARCA}`); // lo scadenzario altrui no
    await prisma.projectMember.deleteMany({ where: { userId: esterna.id } });
  });

  it("il PROGETTO stesso si trova se ci si ha del lavoro, non solo il suo task", async () => {
    // Il difetto: la regola "quali progetti vede l'utente" era scritta in tre
    // modi divergenti — l'elenco contava anche i coinvolti, la ricerca solo i
    // membri. Un referente vedeva il progetto nell'elenco ma non lo trovava
    // cercandolo. Ora la regola e' una sola (visibleProjectsWhere).
    const esterna = await prisma.user.findUniqueOrThrow({
      where: { email: "esterna@test.local" },
    });
    const task = await prisma.task.findFirstOrThrow({ where: { title: `Rilascio ${MARCA}` } });
    await prisma.task.update({ where: { id: task.id }, data: { supervisorId: esterna.id } });
    const tipi = (await cerca(esternaCookie))
      .filter((r) => r.type === "project")
      .map((r) => r.title);
    expect(tipi).toContain(`Progetto ${MARCA}`);
    await prisma.task.update({ where: { id: task.id }, data: { supervisorId: null } });
  });

  it("un task di progetto ASSEGNATO si trova anche senza essere membri", async () => {
    const esterna = await prisma.user.findUniqueOrThrow({
      where: { email: "esterna@test.local" },
    });
    const task = await prisma.task.findFirstOrThrow({
      where: { title: `Rilascio ${MARCA}` },
    });
    await prisma.task.update({ where: { id: task.id }, data: { assigneeId: esterna.id } });
    expect((await cerca(esternaCookie)).map((r) => r.title)).toContain(`Rilascio ${MARCA}`);
    await prisma.task.update({ where: { id: task.id }, data: { assigneeId: null } });
  });
});

/**
 * Un task **chiuso** si cerca eccome: completato non è cancellato, e chi cerca
 * "Non rinnova più" vuole proprio quello. La ricerca li ha sempre trovati — qui
 * si prova che il risultato lo **dichiari**, perché su un task di progetto il
 * sottotitolo porta il progetto e non lo stato: chiuso e aperto si leggevano
 * uguali (19/08/2026).
 */
describe("i task chiusi nella ricerca", () => {
  it("si trovano, e il risultato dice in che stato sono", async () => {
    const chiuso = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: true },
    });
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.local" } });
    await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Canone che non rinnova piu zzz",
        statusId: chiuso.id,
        creatorId: admin.id,
        assigneeId: admin.id,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=rinnova%20piu%20zzz",
      headers: { cookie: adminCookie },
    });
    const trovati = res.json() as Array<{ title: string; closed?: boolean; statusName?: string }>;
    const task = trovati.find((r) => r.title.includes("non rinnova piu"));
    expect(task).toBeTruthy();
    expect(task!.closed).toBe(true);
    expect(task!.statusName).toBe(chiuso.name);
  });
});
