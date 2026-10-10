// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { equivalentStatusId, type RemappableStatus } from "./task-statuses";

// Due liste minime che imitano il seme: apra/chiusi in ordine, categorie diverse.
const ADMIN: RemappableStatus[] = [
  { id: "a1", name: "Da assegnare", isClosed: false, category: "ADMIN", order: 0 },
  { id: "a2", name: "In esecuzione", isClosed: false, category: "ADMIN", order: 1 },
  { id: "a3", name: "In attesa di terzi", isClosed: false, category: "ADMIN", order: 2 },
  { id: "a4", name: "Completato", isClosed: true, category: "ADMIN", order: 3 },
  { id: "a5", name: "Annullato", isClosed: true, category: "ADMIN", order: 4 },
];
const DEV: RemappableStatus[] = [
  { id: "d1", name: "Da fare", isClosed: false, category: "DEV", order: 0 },
  { id: "d2", name: "In sviluppo", isClosed: false, category: "DEV", order: 1 },
  { id: "d3", name: "In attesa di terzi", isClosed: false, category: "DEV", order: 2 },
  { id: "d4", name: "Rilasciato", isClosed: true, category: "DEV", order: 3 },
  { id: "d5", name: "Annullato", isClosed: true, category: "DEV", order: 4 },
];
const ALL = [...ADMIN, ...DEV];

describe("equivalentStatusId", () => {
  it("stesso nome vince, anche a categoria diversa", () => {
    // "In attesa di terzi" esiste in entrambe: si mantiene.
    expect(equivalentStatusId(ADMIN[2], ALL, "DEV")).toBe("d3");
    expect(equivalentStatusId(ADMIN[4], ALL, "DEV")).toBe("d5"); // "Annullato"
  });

  it("senza lo stesso nome, tiene la posizione tra gli aperti", () => {
    // "In esecuzione" è il 2º aperto ADMIN → 2º aperto DEV = "In sviluppo".
    expect(equivalentStatusId(ADMIN[1], ALL, "DEV")).toBe("d2");
    // "Da assegnare" è il 1º aperto → 1º aperto DEV = "Da fare".
    expect(equivalentStatusId(ADMIN[0], ALL, "DEV")).toBe("d1");
  });

  it("un task chiuso resta chiuso", () => {
    // "Completato" (chiuso, 1ª posizione tra i chiusi) → 1º chiuso DEV = "Rilasciato".
    expect(equivalentStatusId(ADMIN[3], ALL, "DEV")).toBe("d4");
  });

  it("senza stato corrente parte dal primo della destinazione", () => {
    expect(equivalentStatusId(null, ALL, "DEV")).toBe("d1");
  });

  it("categoria di destinazione senza stati: nessuna scelta", () => {
    expect(equivalentStatusId(ADMIN[0], ADMIN, "DEV")).toBeUndefined();
  });
});
