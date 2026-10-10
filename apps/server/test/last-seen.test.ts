// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { LAST_SEEN_THRESHOLD_MINUTES, shouldRefreshLastSeen } from "../src/modules/auth/last-seen";

const adesso = new Date("2026-08-05T10:00:00.000Z");
const minutiFa = (n: number) => new Date(adesso.getTime() - n * 60_000);

describe("quando riscrivere l'ultima attività", () => {
  it("la prima volta si scrive sempre", () => {
    expect(shouldRefreshLastSeen(null, adesso)).toBe(true);
  });

  it("entro la soglia non si tocca il database", () => {
    // Sarebbe una scrittura per ogni click: il minuto esatto non serve a nessuno.
    expect(shouldRefreshLastSeen(minutiFa(1), adesso)).toBe(false);
    expect(shouldRefreshLastSeen(minutiFa(LAST_SEEN_THRESHOLD_MINUTES - 1), adesso)).toBe(false);
  });

  it("oltre la soglia si aggiorna", () => {
    expect(shouldRefreshLastSeen(minutiFa(LAST_SEEN_THRESHOLD_MINUTES), adesso)).toBe(true);
    expect(shouldRefreshLastSeen(minutiFa(120), adesso)).toBe(true);
  });

  it("un orario nel futuro (orologio spostato) non blocca l'aggiornamento futuro", () => {
    const futuro = new Date(adesso.getTime() + 60_000);
    expect(shouldRefreshLastSeen(futuro, adesso)).toBe(false);
    expect(shouldRefreshLastSeen(futuro, new Date(futuro.getTime() + 5 * 60_000))).toBe(true);
  });
});
