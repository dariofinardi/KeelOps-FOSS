// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { riprovaQuery } from "./query-retry";

describe("quando ritentare una richiesta", () => {
  it("non ritenta ciò che non cambierà: il record non c'è, o non è tuo", () => {
    expect(riprovaQuery(0, new ApiError(404, "Ticket non trovato"))).toBe(false);
    expect(riprovaQuery(0, new ApiError(403, "Non consentito"))).toBe(false);
  });

  it("un tentativo in più dove il guasto può essere passeggero", () => {
    expect(riprovaQuery(0, new ApiError(502, "Bad gateway"))).toBe(true);
    expect(riprovaQuery(0, new TypeError("Failed to fetch"))).toBe(true);
  });

  it("ma uno solo: insistere non ripara una rete", () => {
    expect(riprovaQuery(1, new ApiError(500, "Errore"))).toBe(false);
  });
});
