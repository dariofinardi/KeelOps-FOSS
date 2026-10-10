// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { DealDetail } from "@kancrm/shared";
import { changedDealFields, dealRestorePayload, snapshotOfDeal } from "./deal-snapshot";

const deal = (over: Partial<DealDetail> = {}): DealDetail =>
  ({
    title: "Portale Acme",
    description: null,
    stage: { id: "s1" },
    company: { id: "c1" },
    contact: null,
    assignee: { id: "u1" },
    dealValue: 17000,
    probability: 60,
    expectedCloseDate: "2026-09-30",
    visibleToSalesMonitors: false,
    ...over,
  }) as DealDetail;

describe("fotografia dell'offerta", () => {
  it("copre tutti i campi che il pannello modifica, spunta compresa", () => {
    // La spunta era sfuggita: chiudendo il pannello dopo averla toccata, la
    // domanda "mantenere le modifiche?" non compariva e non c'era modo di
    // tornare indietro su un'esposizione verso l'esterno.
    const snapshot = snapshotOfDeal(deal());
    expect(changedDealFields(snapshot, deal({ visibleToSalesMonitors: true }))).toEqual([
      "Visibilità ai monitor vendite",
    ]);
  });

  it("elenca in italiano ogni campo toccato", () => {
    const snapshot = snapshotOfDeal(deal());
    expect(
      changedDealFields(snapshot, deal({ dealValue: 20000, visibleToSalesMonitors: true })),
    ).toEqual(["Valore", "Visibilità ai monitor vendite"]);
  });

  it("il ripristino rimette anche la spunta com'era", () => {
    const snapshot = snapshotOfDeal(deal({ visibleToSalesMonitors: true }));
    expect(dealRestorePayload(snapshot).visibleToSalesMonitors).toBe(true);
  });
});
