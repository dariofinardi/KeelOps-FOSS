import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

prepareTestDb("task-company");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * **Il filtro cliente delle bacheche** (19/08/2026).
 *
 * Il punto delicato: il cliente di un task viene da relazioni diverse — il task
 * stesso, l'offerta, il progetto — quindi filtro e colonna devono guardare le
 * stesse vie. Un filtro più stretto della colonna nasconde righe che la pagina
 * mostra col cliente scritto sopra, ed è il genere di difetto che sembra un
 * dato mancante.
 */

let app: App;
let cookie: string;
let statusId: string;
let atlanteId: string;
let altroId: string;
let viaProgettoId: string;
let viaTaskId: string;
let senzaClienteId: string;

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
  const [atlante, altro] = await Promise.all([
    prisma.company.create({ data: { name: "Atlante" } }),
    prisma.company.create({ data: { name: "Altro cliente" } }),
  ]);
  atlanteId = atlante.id;
  altroId = altro.id;

  const progetto = await prisma.project.create({
    data: { name: "Orione", companyId: atlante.id },
  });
  statusId = (
    await prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.ADMIN, isClosed: false },
    })
  ).id;

  // Tre task: uno prende il cliente dal PROGETTO, uno ce l'ha addosso, uno no.
  const [viaProgetto, viaTask, senza] = await Promise.all([
    prisma.task.create({
      data: {
        kind: TaskKind.PROJECT,
        title: "Lavoro di progetto",
        statusId,
        projectId: progetto.id,
        assigneeId: admin.id,
        creatorId: admin.id,
      },
    }),
    prisma.task.create({
      data: {
        kind: TaskKind.ADMIN,
        title: "Pratica intestata",
        statusId,
        companyId: atlante.id,
        assigneeId: admin.id,
        creatorId: admin.id,
      },
    }),
    prisma.task.create({
      data: {
        kind: TaskKind.ADMIN,
        title: "Cosa interna",
        statusId,
        assigneeId: admin.id,
        creatorId: admin.id,
      },
    }),
  ]);
  viaProgettoId = viaProgetto.id;
  viaTaskId = viaTask.id;
  senzaClienteId = senza.id;

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

const lista = async (query: string) => {
  const response = await app.inject({
    method: "GET",
    url: `/api/tasks?includeProjectTasks=true&pageSize=100${query}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    items: Array<{ id: string; title: string; company: { id: string; name: string } | null }>;
    facets: { companies: Array<{ id: string; name: string; count: number }> };
  };
};

describe("filtrare le bacheche per cliente", () => {
  it("prende sia chi ce l'ha addosso sia chi lo eredita dal progetto", async () => {
    const { items } = await lista(`&companyId=${atlanteId}`);
    const ids = items.map((i) => i.id);
    expect(ids).toContain(viaTaskId);
    expect(ids).toContain(viaProgettoId);
    expect(ids).not.toContain(senzaClienteId);
  });

  it("il cliente mostrato in riga è lo stesso su cui si filtra", async () => {
    // La prova che conta: se le due precedenze divergessero, una riga
    // uscirebbe dal filtro pur avendo quel cliente stampato accanto.
    const { items } = await lista("");
    const conAtlante = items.filter((i) => i.company?.id === atlanteId).map((i) => i.id);
    const { items: filtrati } = await lista(`&companyId=${atlanteId}`);
    expect(filtrati.map((i) => i.id).sort()).toEqual(conAtlante.sort());
  });

  it("un altro cliente non porta niente, e non è un errore", async () => {
    const { items } = await lista(`&companyId=${altroId}`);
    expect(items).toEqual([]);
  });

  it("la tendina offre solo i clienti che hanno davvero dei task, col numero", async () => {
    const { facets } = await lista("");
    const atlante = facets.companies.find((c) => c.id === atlanteId);
    expect(atlante?.name).toBe("Atlante");
    expect(atlante?.count).toBe(2);
    // "Altro cliente" esiste in anagrafica ma non ha task: offrirlo vorrebbe
    // dire promettere una lista che sarebbe vuota.
    expect(facets.companies.map((c) => c.id)).not.toContain(altroId);
  });

  it("il conteggio della tendina non si azzera scegliendo il cliente", async () => {
    // Ogni tendina si conta SENZA il proprio filtro, o la voce scelta
    // mostrerebbe il totale di sé stessa e le altre sparirebbero.
    const { facets } = await lista(`&companyId=${atlanteId}`);
    expect(facets.companies.find((c) => c.id === atlanteId)?.count).toBe(2);
  });

  it("la ricerca DENTRO la vista trova per cliente, non solo per titolo", async () => {
    // Il difetto segnalato (20/08/2026): cercando "bore" nella bacheca non
    // usciva il task di "Cornucopia / Boreal", che però ha il nome del cliente
    // stampato sulla card. La ricerca globale lo trovava già; questa no, e la
    // differenza si legge come un record sparito.
    const { items } = await lista("&q=tlan");
    const ids = items.map((i) => i.id);
    expect(ids).toContain(viaTaskId);
    expect(ids).toContain(viaProgettoId);
    expect(ids).not.toContain(senzaClienteId);
  });

  it("la ricerca per titolo continua a funzionare com'era", async () => {
    const { items } = await lista("&q=interna");
    expect(items.map((i) => i.id)).toEqual([senzaClienteId]);
  });

  it("cercare il nome del cliente trova i suoi task, anche via progetto", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/search?q=Atlante",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const results = response.json() as Array<{ type: string; id: string }>;
    const ids = results.map((r) => r.id);
    expect(ids).toContain(viaTaskId);
    expect(ids).toContain(viaProgettoId);
  });
});
