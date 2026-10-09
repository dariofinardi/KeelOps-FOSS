import { describe, expect, it } from "vitest";
import { copertura, daysOfMonth, weeksOfMonth } from "./timesheet-weeks";

/**
 * Il mese è quello del calendario: nessun giorno si perde per strada, nemmeno
 * quelli delle settimane a cavallo. Agosto 2026 comincia di sabato e finisce di
 * lunedì, quindi ha due frammenti — ed è proprio lì che i conti sbagliavano.
 */
describe("le settimane di un mese", () => {
  it("copre tutti i giorni del mese, e solo quelli", () => {
    const settimane = weeksOfMonth("2026-08");
    const giorni = settimane.flatMap((s) => s.days);
    expect(giorni).toEqual(daysOfMonth("2026-08"));
    expect(giorni).toHaveLength(31);
  });

  it("l'1–2 agosto è un frammento di due giorni, non una settimana intera", () => {
    const [primo] = weeksOfMonth("2026-08");
    expect(primo).toMatchObject({ week: "2026-07-27", from: "2026-08-01", to: "2026-08-02" });
    expect(primo!.partial).toBe(true);
    // Sabato e domenica: nessun giorno feriale, quindi nessuna ora dovuta.
    expect(primo!.workdays).toEqual([]);
  });

  it("il 31 agosto è il frammento finale: un lunedì, un giorno feriale", () => {
    const ultimo = weeksOfMonth("2026-08").at(-1)!;
    expect(ultimo).toMatchObject({ from: "2026-08-31", to: "2026-08-31", partial: true });
    expect(ultimo.workdays).toEqual(["2026-08-31"]);
  });

  it("una settimana intera ha cinque feriali e non è parziale", () => {
    const piena = weeksOfMonth("2026-08").find((s) => s.week === "2026-08-03")!;
    expect(piena.days).toHaveLength(7);
    expect(piena.workdays).toHaveLength(5);
    expect(piena.partial).toBe(false);
  });

  it("ogni mese dell'anno torna intero", () => {
    for (let m = 1; m <= 12; m += 1) {
      const mese = `2026-${String(m).padStart(2, "0")}`;
      expect(weeksOfMonth(mese).flatMap((s) => s.days)).toEqual(daysOfMonth(mese));
    }
  });
});

describe("la copertura delle ore", () => {
  it("è la quota delle ore fatte su quelle dovute", () => {
    expect(copertura(40, 40)).toBe(100);
    expect(copertura(20, 40)).toBe(50);
    expect(copertura(48, 40)).toBe(120);
  });

  it("senza ore dovute non c'è quota: dividere per zero direbbe «infinito»", () => {
    expect(copertura(10, 0)).toBeNull();
  });
});
