// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { hideClosedTasks } from "./closed-tasks";

/**
 * "Il task che non si rinnova non è un task cancellato" (19/08/2026): uno
 * stato chiuso che ferma la ricorrenza resta un posto dove il lavoro sta, e
 * chi lo apre deve trovarcelo dentro.
 */
describe("quando i task chiusi restano fuori dalle liste", () => {
  it("di norma sì: le viste di ogni giorno sono fatte di lavoro aperto", () => {
    expect(hideClosedTasks({})).toBe(true);
  });

  it('la spunta "Mostra chiusi" li fa entrare', () => {
    expect(hideClosedTasks({ includeClosed: true })).toBe(false);
  });

  it("scegliere uno stato preciso li fa entrare: altrimenti quella colonna è vuota", () => {
    // Il difetto: `statusId` dello stato "Non rinnova più" e `isClosed: false`
    // non possono essere veri insieme. Sulla copia di produzione filtrare su
    // quello stato dava zero task mentre nella colonna ce n'erano otto.
    expect(hideClosedTasks({ statusId: "non-rinnova-piu" })).toBe(false);
  });

  it("cercare un titolo li fa entrare: si cerca quel task, non i soli aperti", () => {
    expect(hideClosedTasks({ q: "OT Consulting" })).toBe(false);
  });

  it("una ricerca vuota non conta come ricerca", () => {
    expect(hideClosedTasks({ q: "", statusId: null })).toBe(true);
  });
});
