import { describe, expect, it } from "vitest";
import {
  buildForecast,
  currentMonthKey,
  forecastWeight,
  formatShare,
  isInForecastTotal,
  isPastForecastMonth,
  sumForecastMonths,
  type ForecastDeal,
} from "./forecast";

const aperta = (over: Partial<ForecastDeal> = {}): ForecastDeal => ({
  expectedCloseDate: "2026-09-15",
  probability: 60,
  amount: 10000,
  ...over,
});

describe("peso di un'offerta nella previsione", () => {
  it("un'offerta aperta vale la sua probabilità", () => {
    expect(forecastWeight(aperta())).toBe(60);
  });

  it("un'offerta vinta vale tutto, qualunque probabilità avesse", () => {
    expect(forecastWeight(aperta({ stage: { isWon: true, isLost: false } }))).toBe(100);
  });

  it("un'offerta persa non vale niente", () => {
    expect(forecastWeight(aperta({ stage: { isWon: false, isLost: true } }))).toBe(0);
  });

  it("senza probabilità dichiarata non porta valore pesato", () => {
    expect(forecastWeight(aperta({ probability: null }))).toBe(0);
  });
});

describe("previsione per mese", () => {
  it("somma il valore pieno e quello pesato di ogni mese", () => {
    const mesi = buildForecast([
      aperta({ amount: 10000, probability: 50 }),
      aperta({ amount: 4000, probability: 25 }),
    ]);
    expect(mesi).toEqual([
      {
        key: "2026-09",
        count: 2,
        total: 14000,
        weighted: 6000,
        lostCount: 0,
        lostTotal: 0,
        wonCount: 0,
        wonTotal: 0,
      },
    ]);
  });

  it("le vinte contano per intero; le perse restano fuori e si contano a parte", () => {
    // Sommare l'importo di una trattativa persa al totale del mese gonfiava un
    // numero che nessuno incasserà: 8.000 € persi facevano sembrare il mese da
    // 18.000 € quando ne valeva 10.000.
    const [settembre] = buildForecast([
      aperta({ amount: 10000, probability: 20, stage: { isWon: true, isLost: false } }),
      aperta({ amount: 8000, probability: 90, stage: { isWon: false, isLost: true } }),
    ]);
    expect(settembre).toEqual({
      key: "2026-09",
      count: 1,
      total: 10000,
      weighted: 10000,
      lostCount: 1,
      // il valore della persa si tiene a parte: chi vede tutto lo legge fra parentesi
      lostTotal: 8000,
      wonCount: 1,
      wonTotal: 10000,
    });
  });

  it("un mese di sole perse resta visibile, ma senza numeri da incassare", () => {
    const [settembre] = buildForecast([
      aperta({ amount: 8000, probability: 90, stage: { isWon: false, isLost: true } }),
    ]);
    expect(settembre).toEqual({
      key: "2026-09",
      count: 0,
      total: 0,
      weighted: 0,
      lostCount: 1,
      lostTotal: 8000,
      wonCount: 0,
      wonTotal: 0,
    });
  });

  it("separa le vinte da quelle ancora aperte: in un mese passato sono offerte scadute", () => {
    // Il consuntivo del 2026 diceva solo "pesato" e "totale": la differenza fra i
    // due erano offerte rimaste aperte con la data passata, e non si capiva.
    const [settembre] = buildForecast([
      aperta({ amount: 10000, stage: { isWon: true, isLost: false } }),
      aperta({ amount: 40000, probability: 25 }),
    ]);
    expect(settembre).toMatchObject({
      total: 50000,
      weighted: 20000,
      wonCount: 1,
      wonTotal: 10000,
    });
  });

  it("un affare concluso conta nel mese in cui si è chiuso", () => {
    // Sperato a giugno, vinto il 31 luglio: i soldi sono di luglio.
    const mesi = buildForecast([
      aperta({
        expectedCloseDate: "2026-06-30",
        closedAt: "2026-07-31",
        amount: 20000,
        stage: { isWon: true, isLost: false },
      }),
    ]);
    expect(mesi).toEqual([
      {
        key: "2026-07",
        count: 1,
        total: 20000,
        weighted: 20000,
        lostCount: 0,
        lostTotal: 0,
        wonCount: 1,
        wonTotal: 20000,
      },
    ]);
  });

  it("mesi in ordine di calendario, senza data in fondo", () => {
    const mesi = buildForecast([
      aperta({ expectedCloseDate: null }),
      aperta({ expectedCloseDate: "2026-12-01" }),
      aperta({ expectedCloseDate: "2026-07-31" }),
    ]);
    expect(mesi.map((m) => m.key)).toEqual(["2026-07", "2026-12", "senza-data"]);
  });
});

describe("quota condivisa", () => {
  it("si scrive all'italiana, con una cifra decimale anche se tonda", () => {
    expect(formatShare(33.3)).toBe("33,3%");
    expect(formatShare(100)).toBe("100,0%");
    expect(formatShare(0)).toBe("0,0%");
  });

  it("un mese senza quota nota non dichiara niente", () => {
    // Meglio tacere che scrivere uno zero che sembrerebbe "non vedi niente".
    expect(formatShare(null)).toBeNull();
    expect(formatShare(undefined)).toBeNull();
  });
});

describe("mesi passati", () => {
  it("il mese corrente si calcola in ora italiana, non UTC", () => {
    // Il 31 agosto alle 23:30 UTC a Roma è già il 1° settembre.
    expect(currentMonthKey(new Date("2026-08-31T23:30:00Z"))).toBe("2026-09");
    expect(currentMonthKey(new Date("2026-08-15T10:00:00Z"))).toBe("2026-08");
  });

  it("è passato solo ciò che viene prima del mese corrente", () => {
    expect(isPastForecastMonth("2026-07", "2026-08")).toBe(true);
    expect(isPastForecastMonth("2026-08", "2026-08")).toBe(false);
    expect(isPastForecastMonth("2026-09", "2026-08")).toBe(false);
  });

  it('"senza-data" non è mai un mese passato', () => {
    expect(isPastForecastMonth("senza-data", "2026-08")).toBe(false);
  });
});

describe("somma di più mesi", () => {
  it("somma con la stessa logica dei singoli mesi: le perse restano contate a parte", () => {
    expect(
      sumForecastMonths([
        {
          key: "2026-05",
          count: 1,
          total: 9000,
          weighted: 9000,
          lostCount: 0,
          lostTotal: 0,
          wonCount: 1,
          wonTotal: 9000,
        },
        {
          key: "2026-07",
          count: 2,
          total: 9100,
          weighted: 9100,
          lostCount: 4,
          lostTotal: 30000,
          wonCount: 2,
          wonTotal: 9100,
        },
      ]),
    ).toEqual({
      count: 3,
      total: 18100,
      weighted: 18100,
      lostCount: 4,
      lostTotal: 30000,
      wonCount: 3,
      wonTotal: 18100,
    });
  });
});

describe("i mesi del totale in testa", () => {
  it("da questo mese a dicembre, senza gli anni dopo; le offerte senza data contano a dicembre", () => {
    expect(isInForecastTotal("2026-10", "2026-10", [])).toBe(true);
    expect(isInForecastTotal("2026-12", "2026-10", [])).toBe(true);
    expect(isInForecastTotal("2027-01", "2026-10", [])).toBe(false);
    expect(isInForecastTotal("senza-data", "2026-10", [])).toBe(true);
    expect(isInForecastTotal("2026-09", "2026-10", [])).toBe(false);
  });

  it("i mesi passati riaperti dalla pulsantiera lo allargano", () => {
    expect(isInForecastTotal("2026-09", "2026-10", ["2026-09"])).toBe(true);
    expect(isInForecastTotal("2025-12", "2026-10", ["2025-12"])).toBe(true);
  });
});
