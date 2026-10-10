// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { assigneeOptions } from "./assignee-options";

const facet = [
  { id: "g", name: "Giacomo Verdi", count: 1 },
  { id: "d", name: "Dario Ferri", count: 10 },
  { id: "f", name: "Francesca Cavazzoni", count: 101 },
];

describe("assigneeOptions", () => {
  it("io per primo, poi tutti, poi gli altri in ordine alfabetico", () => {
    expect(assigneeOptions(facet, "d").map((o) => [o.value, o.label, o.count])).toEqual([
      ["d", "I miei task", 10],
      ["", "Tutti gli assegnatari", null],
      ["f", "Francesca Cavazzoni", 101],
      ["g", "Giacomo Verdi", 1],
    ]);
  });

  it("senza miei task nel facet, «I miei task» non c'è: un contatore a zero non si mostra", () => {
    expect(assigneeOptions(facet, "x").map((o) => o.value)).toEqual(["", "d", "f", "g"]);
  });

  it("senza facet resta solo «Tutti»", () => {
    expect(assigneeOptions(undefined, "d")).toHaveLength(1);
  });
});
