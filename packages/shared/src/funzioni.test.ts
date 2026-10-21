// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { FUNZIONI_DEL_NUCLEO, funzioniSpenteEffettive, spentaPerColpaDi } from "./funzioni";

const CATALOGO = [
  { chiave: "progetti", richiede: [] },
  { chiave: "ticket", richiede: ["progetti"] },
  { chiave: "modulo-iniettabile", richiede: ["ticket"] },
  { chiave: "offerte", richiede: [] },
  { chiave: "analisi-offerte", richiede: ["offerte"] },
];

describe("funzioni spente in effetti", () => {
  it("niente di spento: niente di spento", () => {
    expect([...funzioniSpenteEffettive([], CATALOGO)]).toEqual([]);
  });

  it("spegnere una funzione spegne chi dipende da lei, anche di più passi", () => {
    expect([...funzioniSpenteEffettive(["progetti"], CATALOGO)].sort()).toEqual([
      "modulo-iniettabile",
      "progetti",
      "ticket",
    ]);
  });

  it("spegnere una dipendente non tocca ciò da cui dipende", () => {
    expect([...funzioniSpenteEffettive(["ticket"], CATALOGO)].sort()).toEqual([
      "modulo-iniettabile",
      "ticket",
    ]);
  });

  it("una chiave sconosciuta resta spenta: un modulo dimenticato non si riaccende", () => {
    expect(funzioniSpenteEffettive(["sconosciuto"], CATALOGO).has("sconosciuto")).toBe(true);
  });
});

describe("perché una funzione è spenta", () => {
  const spente = funzioniSpenteEffettive(["progetti"], CATALOGO);
  it("nomina la funzione spenta a mano da cui dipende, anche di più passi", () => {
    expect(spentaPerColpaDi("modulo-iniettabile", new Set(["progetti"]), CATALOGO)).toEqual([
      "progetti",
    ]);
    expect(spente.has("modulo-iniettabile")).toBe(true);
  });
  it("vuoto per chi è spenta a mano e per chi è accesa", () => {
    expect(spentaPerColpaDi("progetti", new Set(["progetti"]), CATALOGO)).toEqual([]);
    expect(spentaPerColpaDi("analisi-offerte", new Set(["progetti"]), CATALOGO)).toEqual([]);
  });
});

describe("il catalogo del nucleo", () => {
  it("non contiene lo scadenzario e ha chiavi uniche", () => {
    const chiavi = FUNZIONI_DEL_NUCLEO.map((f) => f.chiave);
    expect(new Set(chiavi).size).toBe(chiavi.length);
    expect(chiavi).not.toContain("scadenzario");
  });
});
