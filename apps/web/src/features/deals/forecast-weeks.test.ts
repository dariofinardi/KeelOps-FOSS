import { describe, expect, it } from "vitest";
import { buildForecastWeeks, undatedDay } from "./forecast-weeks";
import type { ForecastDeal } from "./forecast";

const aperta = (over: Partial<ForecastDeal> = {}): ForecastDeal => ({
  expectedCloseDate: "2026-10-07",
  probability: 50,
  amount: 1000,
  ...over,
});
const vinta = { isWon: true, isLost: false };
const persa = { isWon: false, isLost: true };

describe("la previsione per settimana", () => {
  it("le settimane dei mesi scelti, tutte, anche vuote, dal lunedì alla domenica", () => {
    const { weeks } = buildForecastWeeks([], "2026-10", []);
    // ottobre–dicembre 2026: dal lunedì 28 settembre al lunedì 28 dicembre
    expect(weeks[0]).toMatchObject({ start: "2026-09-28", end: "2026-10-04", count: 0 });
    expect(weeks.at(-1)!.start).toBe("2026-12-28");
    expect(weeks).toHaveLength(14);
    expect(weeks.every((w) => w.min === null && w.avg === null)).toBe(true);
  });

  it("minimo, massimo e media della settimana; le perse fuori", () => {
    const { weeks } = buildForecastWeeks(
      [
        aperta({ amount: 1000 }),
        aperta({ amount: 4000, expectedCloseDate: "2026-10-08" }),
        aperta({ amount: 7000, expectedCloseDate: "2026-10-09", stage: vinta }),
        aperta({ amount: 90000, stage: persa }),
      ],
      "2026-10",
      [],
    );
    const settimana = weeks.find((w) => w.start === "2026-10-05")!;
    expect(settimana).toMatchObject({ count: 3, min: 1000, max: 7000, avg: 4000, total: 12000 });
    // aperte al 50%, la vinta per intero
    expect(settimana.weighted).toBe(500 + 2000 + 7000);
  });

  it("le offerte senza data si spargono sulla prima metà di dicembre", () => {
    expect(undatedDay(0, 3, "2026")).toBe("2026-12-01");
    expect(undatedDay(1, 3, "2026")).toBe("2026-12-06");
    expect(undatedDay(2, 3, "2026")).toBe("2026-12-11");
    const senza = Array.from({ length: 6 }, () => aperta({ expectedCloseDate: null }));
    const { weeks, kpi } = buildForecastWeeks(senza, "2026-10", []);
    const conOfferte = weeks.filter((w) => w.count > 0);
    expect(conOfferte.every((w) => w.start >= "2026-11-30" && w.start <= "2026-12-14")).toBe(true);
    expect(conOfferte.length).toBeGreaterThan(1);
    expect(kpi).toMatchObject({ count: 6, undatedCount: 6 });
  });

  it("fuori dalla selezione non conta: anni dopo, mesi passati non riaperti", () => {
    const dati = [
      aperta({ expectedCloseDate: "2027-02-10" }),
      aperta({ expectedCloseDate: "2026-06-10", amount: 3000 }),
      aperta({ expectedCloseDate: "2026-10-07" }),
    ];
    expect(buildForecastWeeks(dati, "2026-10", []).kpi.count).toBe(1);
    const conGiugno = buildForecastWeeks(dati, "2026-10", ["2026-06"]);
    expect(conGiugno.kpi.count).toBe(2);
    expect(conGiugno.weeks[0]!.start).toBe("2026-06-01");
  });

  it("i KPI del periodo: offerte, valori, vinte", () => {
    const { kpi } = buildForecastWeeks(
      [aperta({ amount: 2000 }), aperta({ amount: 6000, stage: vinta }), aperta({ amount: null })],
      "2026-10",
      [],
    );
    // l'offerta senza importo conta fra le offerte, non nei valori
    expect(kpi).toMatchObject({
      count: 3,
      total: 8000,
      weighted: 1000 + 6000,
      min: 2000,
      max: 6000,
      avg: 4000,
      wonCount: 1,
      wonTotal: 6000,
      undatedCount: 0,
    });
  });
});

describe("con il filtro per mese", () => {
  it("il periodo sono i mesi scelti, anche fuori dall'anno; senza data a dicembre se scelta", () => {
    const dati = [
      aperta({ expectedCloseDate: "2027-02-10" }),
      aperta({ expectedCloseDate: "2026-10-07" }),
      aperta({ expectedCloseDate: null }),
    ];
    const febbraio = buildForecastWeeks(dati, "2026-10", [], ["2027-02"]);
    expect(febbraio.kpi.count).toBe(1);
    expect(febbraio.weeks[0]!.start).toBe("2027-02-01");
    const conSenza = buildForecastWeeks(dati, "2026-10", [], ["2027-02", "senza-data"]);
    expect(conSenza.kpi).toMatchObject({ count: 2, undatedCount: 1 });
    expect(conSenza.weeks.some((w) => w.start.startsWith("2026-12"))).toBe(true);
  });
});
