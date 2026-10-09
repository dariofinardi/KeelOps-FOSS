import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { dealNextStepScenario } from "./support/deal-next-step-scenario";

const { tempDir } = prepareTestDb("deal-next-step");

const { prisma } = await import("../src/db");
const { dayInRome } = await import("../src/lib/date");

/**
 * **Il prossimo passo delle offerte, e le offerte ferme** (17/09/2026).
 *
 * La regola pura è provata in `packages/shared/src/deal-next-step.test.ts`;
 * qui si prova che il server la applica sui dati veri: quale task sceglie (i
 * chiusi e quelli nel cestino non contano), il filtro «Ferme» scritto come
 * `where` con i suoi numeri, l'ordinamento per passo su più pagine. Quello che
 * arriva al monitor vendite sta in `commercial/deal-next-step-monitor.test.ts`.
 *
 * Le date sono relative a oggi (nel fuso aziendale): il test non invecchia.
 */

type App = Awaited<ReturnType<typeof dealNextStepScenario>>["app"];
let app: App;
let adminCookie = "";
let ctx: Awaited<ReturnType<typeof dealNextStepScenario>>;

const giorno = (delta: number) => {
  const base = new Date(`${dayInRome()}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + delta);
  return base;
};
const iso = (delta: number) => giorno(delta).toISOString().slice(0, 10);

const offerte: Record<string, string> = {};

type Riga = {
  id: string;
  title: string;
  openTaskCount: number;
  nextStep: {
    id: string;
    title: string;
    dueDate: string | null;
    assigneeName: string | null;
  } | null;
};

const elenco = async (query = "") => {
  const res = await app.inject({
    method: "GET",
    url: `/api/deals?pageSize=50${query}`,
    headers: { cookie: adminCookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    items: Riga[];
    total: number;
    facets: { stalled: Record<string, number> };
  };
};
const titoli = (righe: Riga[]) => righe.map((r) => r.title).sort();

beforeAll(async () => {
  ctx = await dealNextStepScenario();
  app = ctx.app;
  adminCookie = ctx.adminCookie;
  Object.assign(offerte, ctx.offerte);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("il prossimo passo nell'elenco delle offerte", () => {
  it("è il primo task aperto per scadenza; chiusi e cestinati non contano", async () => {
    const { items } = await elenco("&includeClosed=true");
    const riga = (title: string) => items.find((r) => r.title === title)!;

    expect(riga("Senza passo").nextStep).toBeNull();
    expect(riga("Passo scaduto").nextStep).toMatchObject({
      title: "Richiamare il cliente",
      dueDate: iso(-3),
      assigneeName: "Ada Admin",
    });
    expect(riga("Passo scaduto").openTaskCount).toBe(2);
    expect(riga("Passo senza data").nextStep).toMatchObject({
      title: "Da pianificare",
      dueDate: null,
    });
  });
});

describe("il filtro «Ferme»", () => {
  it("conta le ferme per ragione, senza contare il filtro stesso", async () => {
    const { facets } = await elenco("&stalled=passoScaduto");
    expect(facets.stalled).toEqual({
      tutte: 3,
      senzaPasso: 1,
      passoScaduto: 1,
      chiusuraPassata: 1,
    });
  });

  it("filtra le ferme in tutto e per ragione; una conclusa non è mai ferma", async () => {
    expect(titoli((await elenco("&stalled=tutte&includeClosed=true")).items)).toEqual([
      "Chiusura passata",
      "Passo scaduto",
      "Senza passo",
    ]);
    expect(titoli((await elenco("&stalled=senzaPasso")).items)).toEqual(["Senza passo"]);
    expect(titoli((await elenco("&stalled=passoScaduto")).items)).toEqual(["Passo scaduto"]);
    expect(titoli((await elenco("&stalled=chiusuraPassata")).items)).toEqual(["Chiusura passata"]);
  });

  it("si combina con la ricerca senza che un OR cancelli l'altro", async () => {
    const { items, total } = await elenco("&stalled=tutte&q=passo");
    expect(titoli(items)).toEqual(["Passo scaduto", "Senza passo"]);
    expect(total).toBe(2);
  });
});

describe("ordinare per prossimo passo", () => {
  it("prima i più vicini (scaduti in testa), poi i senza data, in fondo chi non ha passo", async () => {
    const { items } = await elenco("&sortBy=nextStep&sortDir=asc");
    expect(items.map((r) => r.title)).toEqual([
      "Passo scaduto",
      "In moto",
      "Chiusura passata",
      "Passo senza data",
      "Senza passo",
    ]);
  });

  it("la paginazione segue lo stesso ordine", async () => {
    const pagina = async (page: number) =>
      (
        await app.inject({
          method: "GET",
          url: `/api/deals?sortBy=nextStep&sortDir=asc&pageSize=2&page=${page}`,
          headers: { cookie: adminCookie },
        })
      ).json() as { items: Riga[]; total: number };
    const [prima, seconda, terza] = await Promise.all([pagina(1), pagina(2), pagina(3)]);
    expect(prima.total).toBe(5);
    expect([...prima.items, ...seconda.items, ...terza.items].map((r) => r.title)).toEqual([
      "Passo scaduto",
      "In moto",
      "Chiusura passata",
      "Passo senza data",
      "Senza passo",
    ]);
  });
});
