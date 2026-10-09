import { describe, expect, it } from "vitest";
import { activeCount, clampPage, invalidSelections } from "./list-filters";

describe("invalidSelections (condiviso da task e offerte)", () => {
  it("azzera i valori che non sono più tra le opzioni", () => {
    // Caso reale: l'azienda del filtro è stata eliminata → lista vuota con la
    // tendina che mostra "Tutti i clienti".
    expect(
      invalidSelections(
        { companyId: "eliminata", stageId: "s1" },
        { companyId: ["c1", "c2"], stageId: ["s1"] },
      ),
    ).toEqual({ companyId: "" });
  });

  it("non tocca nulla se tutto è valido o se non c'è selezione", () => {
    expect(invalidSelections({ a: "x" }, { a: ["x", "y"] })).toEqual({});
    expect(invalidSelections({ a: "" }, { a: ["x"] })).toEqual({});
  });

  it("con opzioni non ancora caricate lascia i filtri salvati", () => {
    expect(invalidSelections({ a: "x" }, { a: [] })).toEqual({});
  });
});

describe("activeCount", () => {
  it("conta i valori non vuoti più la ricerca", () => {
    expect(activeCount({ a: "", b: "" })).toBe(0);
    expect(activeCount({ a: "x", b: "" })).toBe(1);
    expect(activeCount({ a: "x", b: "y" }, "fattura")).toBe(3);
    expect(activeCount({ a: "x" }, "   ")).toBe(1); // ricerca di soli spazi ignorata
  });
});

describe("clampPage", () => {
  it("riporta la pagina nell'intervallo valido", () => {
    expect(clampPage(5, 60, 50)).toBe(2);
    expect(clampPage(2, 120, 50)).toBe(2);
    expect(clampPage(4, 0, 50)).toBe(1);
    expect(clampPage(0, 100, 50)).toBe(1);
  });
});
