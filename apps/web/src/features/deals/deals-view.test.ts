// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  closeDateFields,
  displayProbability,
  formatDealValue,
  includeClosedForView,
} from "./deals-view";

describe("quali offerte chiede ogni vista", () => {
  it("nella tabella decide l'utente con la spunta", () => {
    expect(includeClosedForView("table", false)).toBe(false);
    expect(includeClosedForView("table", true)).toBe(true);
  });

  it("il forecast le vuole tutte, spunta della tabella o no", () => {
    // Il difetto che questo previene: le vinte non arrivavano proprio al calcolo,
    // e un mese in cui si era chiuso un affare risultava quasi vuoto.
    expect(includeClosedForView("forecast", false)).toBe(true);
  });

  it("anche il kanban le vuole tutte: ha le colonne Vinta e Persa", () => {
    expect(includeClosedForView("pipeline", false)).toBe(true);
  });
});

describe("data mostrata in elenco", () => {
  it("conclusa: la data in cui si è chiusa, segnalata come tale", () => {
    expect(closeDateFields({ closedAt: "2026-07-31", expectedCloseDate: "2026-06-30" })).toEqual({
      date: "2026-07-31",
      closed: true,
    });
  });

  it("aperta: la chiusura prevista", () => {
    expect(closeDateFields({ closedAt: null, expectedCloseDate: "2026-06-30" })).toEqual({
      date: "2026-06-30",
      closed: false,
    });
  });
});

const fase = (over = {}) => ({ isWon: false, isLost: false, ...over });

describe("probabilità mostrata in elenco", () => {
  it("aperta: quella dichiarata dal commerciale", () => {
    expect(displayProbability({ probability: 60, stage: fase() })).toEqual({
      percent: 60,
      declared: null,
    });
  });

  it("vinta: cento per cento, con la dichiarata da spiegare nel suggerimento", () => {
    // In elenco si leggeva "80%" su un'offerta vinta, mentre la previsione la
    // contava per intero: sembrava che i conti non tornassero.
    expect(displayProbability({ probability: 80, stage: fase({ isWon: true }) })).toEqual({
      percent: 100,
      declared: 80,
    });
  });

  it("persa: zero", () => {
    expect(displayProbability({ probability: 10, stage: fase({ isLost: true }) })).toEqual({
      percent: 0,
      declared: 10,
    });
  });
});

const euro = { format: (v: number) => `${v} EUR` };

describe("valore dell'elenco offerte", () => {
  it("in giornate scrive le giornate, già convertite dal server", () => {
    expect(formatDealValue(8, "DAYS", euro)).toBe("8 gg");
    expect(formatDealValue(1200, "DAYS", euro)).toBe("1.200 gg");
  });

  it("in euro passa al formattatore della valuta dell'utente", () => {
    expect(formatDealValue(4100, "EUR", euro)).toBe("4100 EUR");
  });

  it("senza valore non scrive niente, in nessuna unità", () => {
    expect(formatDealValue(null, "DAYS", euro)).toBe("—");
    expect(formatDealValue(null, "EUR", euro)).toBe("—");
  });
});
