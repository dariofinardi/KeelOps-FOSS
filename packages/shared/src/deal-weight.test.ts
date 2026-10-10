// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  dealForecastDate,
  dealValueToDays,
  dealWeightPercent,
  dealWeightedValue,
} from "./deal-weight";

describe("peso di un'offerta", () => {
  it("finché è aperta vale la probabilità dichiarata", () => {
    expect(dealWeightPercent({ value: 10000, probability: 60 })).toBe(60);
    expect(dealWeightedValue({ value: 10000, probability: 60 })).toBe(6000);
  });

  it("vinta vale tutto, qualunque probabilità le fosse rimasta scritta", () => {
    expect(dealWeightedValue({ value: 10000, probability: 20, isWon: true })).toBe(10000);
  });

  it("persa non vale niente", () => {
    // È il punto: un'offerta persa da 20.000 € non conta 20.000 € in nessun
    // conto previsionale, nemmeno in quelli di copertura.
    expect(dealWeightedValue({ value: 20000, probability: 90, isLost: true })).toBe(0);
  });

  it("senza probabilità e senza importo non porta niente", () => {
    expect(dealWeightedValue({ value: 10000, probability: null })).toBe(0);
    expect(dealWeightedValue({ value: null, probability: 80 })).toBe(0);
  });
});

describe("mese sotto cui contare un'offerta", () => {
  it("conclusa: conta il giorno in cui si è chiusa", () => {
    // Sperata a giugno, vinta il 31 luglio: è denaro di luglio.
    expect(dealForecastDate({ closedAt: "2026-07-31", expectedCloseDate: "2026-06-30" })).toBe(
      "2026-07-31",
    );
  });

  it("ancora aperta: conta la chiusura prevista", () => {
    expect(dealForecastDate({ closedAt: null, expectedCloseDate: "2026-06-30" })).toBe(
      "2026-06-30",
    );
  });

  it("senza nessuna delle due non ha un mese", () => {
    expect(dealForecastDate({})).toBeNull();
  });
});

describe("valore in giornate di lavoro", () => {
  it("500 € fanno una giornata, arrotondata all'intero", () => {
    expect(dealValueToDays(4100)).toBe(8);
    expect(dealValueToDays(500)).toBe(1);
  });

  it("da mezza giornata in su si sale, sotto si scende", () => {
    // 1,5 giornate → 2; 1,2 → 1. Si lavora a giornate, non a frazioni.
    expect(dealValueToDays(750)).toBe(2);
    expect(dealValueToDays(600)).toBe(1);
    expect(dealValueToDays(249)).toBe(0);
  });

  it("senza valore non ci sono giornate", () => {
    expect(dealValueToDays(null)).toBeNull();
  });
});
