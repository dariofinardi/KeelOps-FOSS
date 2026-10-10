// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  dateOnlyToUTC,
  mondayOf,
  parseDateOnly,
  startOfTodayUTC,
  toDateOnly,
} from "../src/lib/date";
import { median, quantile } from "../src/lib/stats";

describe("le date del dominio (lib/date)", () => {
  it("YYYY-MM-DD ⇄ mezzanotte UTC, andata e ritorno", () => {
    const d = dateOnlyToUTC("2026-08-22");
    expect(d.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(toDateOnly(d)).toBe("2026-08-22");
    expect(toDateOnly(null)).toBeNull();
  });

  it("l'input non fidato torna null, mai una Invalid Date", () => {
    // Una Invalid Date avvelena i confronti tre funzioni più in là:
    // qui muore subito.
    expect(parseDateOnly("2026-08-22")?.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    for (const cattivo of ["22/08/2026", "2026-13-45", "", 42, null, undefined, "2026-08-22T10:00"]) {
      expect(parseDateOnly(cattivo), String(cattivo)).toBeNull();
    }
  });

  it("startOfTodayUTC azzera l'orario senza toccare il giorno", () => {
    expect(startOfTodayUTC(new Date("2026-08-22T23:59:59.999Z")).toISOString()).toBe(
      "2026-08-22T00:00:00.000Z",
    );
  });

  it("mondayOf: il lunedì della settimana, anche a cavallo di mese e anno", () => {
    expect(toDateOnly(mondayOf(new Date("2026-08-22T15:00:00Z")))).toBe("2026-08-17"); // sabato
    expect(toDateOnly(mondayOf(new Date("2026-08-17T00:00:00Z")))).toBe("2026-08-17"); // lunedì stesso
    expect(toDateOnly(mondayOf(new Date("2026-08-23T00:00:00Z")))).toBe("2026-08-17"); // domenica
    expect(toDateOnly(mondayOf(new Date("2026-01-01T00:00:00Z")))).toBe("2025-12-29"); // capodanno
  });
});

describe("statistiche di posizione (lib/stats)", () => {
  it("mediana su pari e dispari", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("il vuoto è null, non zero: «mediana zero» significherebbe un'altra cosa", () => {
    // Le due copie precedenti avevano già divergito proprio qui.
    expect(median([])).toBeNull();
    expect(quantile([], 0.5)).toBeNull();
  });

  it("quantile grezzo, estremi compresi", () => {
    const v = [10, 20, 30, 40];
    expect(quantile(v, 0)).toBe(10);
    expect(quantile(v, 0.5)).toBe(30);
    expect(quantile(v, 1)).toBe(40);
  });
});
