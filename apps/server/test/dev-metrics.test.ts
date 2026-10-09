import { describe, expect, it } from "vitest";
import {
  coverage,
  hoursByProject,
  isBornClosed,
  isImportedHistory,
  lastWeeks,
  median,
  quantile,
  size,
  times,
  weeklyFlow,
  type ClosedTask,
} from "../src/modules/dev-metrics/dev-metrics";

/**
 * I conti del pannello **L'andamento**. Sono numeri che le persone leggeranno
 * riferiti a sé stesse, quindi qui si prova soprattutto **ciò che resta fuori**
 * dai tempi: un conto sbagliato in questa direzione non dà un errore, dà una
 * classifica falsa che qualcuno prenderà per vera.
 */

const task = (
  over: Omit<Partial<ClosedTask>, "createdAt" | "closedAt"> & {
    createdAt: string;
    closedAt: string;
  },
): ClosedTask => ({
  id: over.id ?? "t",
  assigneeId: over.assigneeId ?? "u1",
  createdAt: new Date(over.createdAt),
  closedAt: new Date(over.closedAt),
  // Il caso normale è il task nato qui: la prima traccia è la creazione.
  firstLogAt: over.firstLogAt === undefined ? new Date(over.createdAt) : over.firstLogAt,
  firstChangeAt: over.firstChangeAt ?? null,
  hours: over.hours ?? 0,
});

describe("task nati già chiusi", () => {
  it("un task creato e chiuso nella stessa ora non ha vissuto", () => {
    expect(
      isBornClosed(task({ createdAt: "2026-08-03T09:00:00Z", closedAt: "2026-08-03T09:20:00Z" })),
    ).toBe(true);
    expect(
      isBornClosed(task({ createdAt: "2026-08-03T09:00:00Z", closedAt: "2026-08-03T14:00:00Z" })),
    ).toBe(false);
  });

  it("restano fuori dai tempi, ma il loro numero si dichiara", () => {
    // Il caso vero (misura del 18/08/2026): chi registra il lavoro a cose fatte
    // sembrerebbe fulmineo. Il tempo si calcola su chi ha vissuto, e quanti
    // sono gli altri lo dice il pannello.
    const result = times([
      task({ createdAt: "2026-08-03T09:00:00Z", closedAt: "2026-08-03T09:05:00Z" }),
      task({ createdAt: "2026-08-03T09:00:00Z", closedAt: "2026-08-03T09:10:00Z" }),
      task({
        createdAt: "2026-08-03T09:00:00Z",
        closedAt: "2026-08-05T09:00:00Z",
        firstChangeAt: new Date("2026-08-04T09:00:00Z"),
      }),
    ]);
    expect(result.natiChiusi).toBe(2);
    expect(result.campione).toBe(1);
    expect(result.totale).toBe(2);
    expect(result.presaInCarico).toBe(1);
    expect(result.lavorazione).toBe(1);
  });

  it("senza un cambio di stato registrato i due tempi parziali non esistono", () => {
    // Lo storico importato non ha cronologia: meglio nessun numero che uno
    // costruito facendo finta che la creazione sia una presa in carico.
    const result = times([
      task({ createdAt: "2026-08-03T09:00:00Z", closedAt: "2026-08-06T09:00:00Z" }),
    ]);
    expect(result.totale).toBe(3);
    expect(result.presaInCarico).toBeNull();
    expect(result.lavorazione).toBeNull();
  });
});

describe("storico importato", () => {
  it("un record la cui data di creazione precede la sua prima traccia è archivio", () => {
    // ClickUp e osTicket: 104 record su 155 "chiusi" in quattro settimane,
    // alcuni del 2023. Il tempo mediano di squadra usciva 156 giorni.
    expect(
      isImportedHistory({
        createdAt: new Date("2025-03-01T09:00:00Z"),
        firstLogAt: new Date("2026-08-07T10:00:00Z"),
      }),
    ).toBe(true);
    expect(
      isImportedHistory({
        createdAt: new Date("2026-08-03T09:00:00Z"),
        firstLogAt: new Date("2026-08-03T09:00:01Z"),
      }),
    ).toBe(false);
  });

  it("senza nessuna traccia il record non si può datare: resta fuori", () => {
    expect(
      isImportedHistory({ createdAt: new Date("2026-08-03T09:00:00Z"), firstLogAt: null }),
    ).toBe(true);
  });

  it("non entra nei tempi nemmeno se glielo si passa", () => {
    // Rete di sicurezza: il servizio lo filtra già a monte, ma un chiamante
    // nuovo non deve poter far ricomparire i 156 giorni.
    const result = times([
      task({
        createdAt: "2025-03-01T09:00:00Z",
        closedAt: "2026-08-07T10:00:00Z",
        firstLogAt: new Date("2026-08-07T10:00:00Z"),
        firstChangeAt: new Date("2026-08-07T10:00:00Z"),
      }),
      task({
        createdAt: "2026-08-03T09:00:00Z",
        closedAt: "2026-08-05T09:00:00Z",
        firstChangeAt: new Date("2026-08-04T09:00:00Z"),
      }),
    ]);
    expect(result.campione).toBe(1);
    expect(result.totale).toBe(2);
    expect(result.natiChiusi).toBe(0);
  });
});

describe("mediana e quantili", () => {
  it("su elenco vuoto non inventano un numero", () => {
    expect(median([])).toBeNull();
    expect(quantile([], 0.25)).toBeNull();
  });

  it("la mediana è il valore di mezzo, non la media", () => {
    // Con un massimo di 11,5 su una mediana di 1,5 la media mente.
    expect(median([1, 1, 1.5, 2.5, 11.5])).toBe(1.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("taglia del lavoro", () => {
  it("conta solo i task con ore, ma dice su quanti è calcolata", () => {
    const result = size([
      task({ createdAt: "2026-08-03T09:00:00Z", closedAt: "2026-08-04T09:00:00Z", hours: 1 }),
      task({ createdAt: "2026-08-03T09:00:00Z", closedAt: "2026-08-04T09:00:00Z", hours: 4 }),
      task({ createdAt: "2026-08-03T09:00:00Z", closedAt: "2026-08-04T09:00:00Z", hours: 0 }),
    ]);
    expect(result.medianaOre).toBe(2.5);
    expect(result.conOre).toBe(2);
    expect(result.totali).toBe(3);
  });
});

describe("copertura del timesheet", () => {
  const from = new Date("2026-08-03T00:00:00Z"); // lunedì
  const to = new Date("2026-08-07T00:00:00Z"); // venerdì

  it("si misura sui giorni lavorati, non sui giorni feriali", () => {
    // Il caso vero (18/08/2026): due settimane di ferie contavano come due
    // settimane di timesheet non compilato, e chi rientrava dalle vacanze
    // risultava al 35% invece che all'86%.
    const ferie = coverage(["2026-08-06", "2026-08-07"], ["2026-08-06", "2026-08-07"], from, to);
    expect(ferie).toEqual({ compilati: 2, lavorati: 2, percento: 100 });
  });

  it("un giorno lavorato senza ore abbassa la copertura", () => {
    expect(coverage(["2026-08-03"], ["2026-08-03", "2026-08-04"], from, to)).toEqual({
      compilati: 1,
      lavorati: 2,
      percento: 50,
    });
  });

  it("le ore di un giorno senza altre tracce contano come giorno lavorato", () => {
    // Si può compilare il venerdì per tutta la settimana senza aver toccato un
    // record quel giorno: quelle ore non devono peggiorare la propria copertura.
    expect(coverage(["2026-08-03", "2026-08-04"], [], from, to)).toEqual({
      compilati: 2,
      lavorati: 2,
      percento: 100,
    });
  });

  it("chi non ha lavorato non ha una percentuale: le ferie non sono un ritardo", () => {
    expect(coverage([], [], from, to).percento).toBeNull();
  });

  it("il fine settimana non conta né a favore né contro", () => {
    // Chi lavora di sabato non deve risultare più diligente di chi non lo fa:
    // sui dati veri una persona aveva 23 giorni compilati su 21 feriali.
    const domenica = new Date("2026-08-09T00:00:00Z");
    const weekend = coverage(["2026-08-08", "2026-08-09"], ["2026-08-08"], from, domenica);
    expect(weekend).toEqual({ compilati: 0, lavorati: 0, percento: null });
  });
});

describe("flusso settimanale", () => {
  it("mette ogni data nella settimana del suo lunedì", () => {
    const weeks = ["2026-08-03", "2026-08-10"];
    expect(
      weeklyFlow(
        [new Date("2026-08-05T10:00:00Z"), new Date("2026-08-09T23:00:00Z")],
        [new Date("2026-08-11T08:00:00Z")],
        weeks,
      ),
    ).toEqual([
      { week: "2026-08-03", entrati: 2, usciti: 0 },
      { week: "2026-08-10", entrati: 0, usciti: 1 },
    ]);
  });

  it("le settimane vuote restano in elenco, a zero", () => {
    expect(weeklyFlow([], [], lastWeeks(new Date("2026-08-18T12:00:00Z"), 4))).toEqual([
      { week: "2026-07-27", entrati: 0, usciti: 0 },
      { week: "2026-08-03", entrati: 0, usciti: 0 },
      { week: "2026-08-10", entrati: 0, usciti: 0 },
      { week: "2026-08-17", entrati: 0, usciti: 0 },
    ]);
  });
});

describe("ore per progetto", () => {
  it("somma, ordina dal più grande e NON butta via le ore senza progetto", () => {
    // Erano l'11% del totale alla prima misura: un buco nella ripartizione che
    // chi guarda deve vedere, non un arrotondamento da nascondere.
    expect(
      hoursByProject([
        { project: "Atlante", hours: 4 },
        { project: null, hours: 2 },
        { project: "Atlante", hours: 1.5 },
      ]),
    ).toEqual([
      { project: "Atlante", hours: 5.5 },
      { project: null, hours: 2 },
    ]);
  });
});
