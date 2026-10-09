import { describe, expect, it } from "vitest";
import {
  dealMonthKey,
  matchesDealMonths,
  monthRangeUTC,
  parseDealMonths,
  SENZA_DATA,
} from "./deal-months";

describe("il mese di un'offerta", () => {
  it("conta la chiusura effettiva, poi la prevista, poi «senza data»", () => {
    expect(dealMonthKey({ closedAt: "2026-07-31", expectedCloseDate: "2026-06-30" })).toBe(
      "2026-07",
    );
    expect(dealMonthKey({ closedAt: null, expectedCloseDate: "2026-06-30" })).toBe("2026-06");
    expect(dealMonthKey({ closedAt: null, expectedCloseDate: null })).toBe(SENZA_DATA);
  });

  it("il filtro in query string: voci valide, senza doppioni, in ordine", () => {
    expect(parseDealMonths("2026-10,senza-data,2026-09,2026-10,2026-13,ciao")).toEqual([
      "2026-09",
      "2026-10",
      "senza-data",
    ]);
    expect(parseDealMonths("")).toEqual([]);
    expect(parseDealMonths(undefined)).toEqual([]);
  });

  it("nessun mese scelto = tutte; altrimenti solo quelle dei mesi scelti", () => {
    const giugno = { expectedCloseDate: "2026-06-10" };
    const senza = { expectedCloseDate: null };
    expect(matchesDealMonths(giugno, [])).toBe(true);
    expect(matchesDealMonths(giugno, ["2026-06"])).toBe(true);
    expect(matchesDealMonths(giugno, ["2026-07"])).toBe(false);
    expect(matchesDealMonths(senza, [SENZA_DATA])).toBe(true);
  });

  it("gli estremi del mese in UTC, dicembre compreso", () => {
    expect(monthRangeUTC("2026-12")).toEqual({
      da: new Date("2026-12-01T00:00:00.000Z"),
      a: new Date("2027-01-01T00:00:00.000Z"),
    });
  });
});
