// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  RIQUADRI_DI_SERIE,
  chiudiRiquadro,
  normalizzaLayout,
  riordinaRiquadri,
  spostaRiquadro,
} from "./layout";

const TUTTI = [...RIQUADRI_DI_SERIE.sinistra, ...RIQUADRI_DI_SERIE.destra];

describe("la disposizione dei riquadri della giornata", () => {
  it("senza niente di salvato è quella di serie, con «Senza scadenza» chiuso", () => {
    expect(normalizzaLayout(null, TUTTI)).toEqual(RIQUADRI_DI_SERIE);
  });

  it("tiene l'ordine salvato, scarta gli sconosciuti e i doppioni, accoda i nuovi al posto di serie", () => {
    const salvato = {
      sinistra: ["byStatus", "overdue", "fantasma", "overdue"],
      destra: ["deals"],
      chiusi: { overdue: true, fantasma: true, deals: "sì" as unknown as boolean },
    };
    const out = normalizzaLayout(salvato, [...TUTTI, "plugin:Personale"]);
    expect(out.sinistra).toEqual([
      "byStatus",
      "overdue",
      "dueToday",
      "dueTomorrow",
      "nextDays",
      "noDueDate",
      "plugin:Personale",
    ]);
    expect(out.destra).toEqual(["deals", "unassigned", "tickets"]);
    expect(out.chiusi).toEqual({ noDueDate: true, overdue: true });
  });

  it("un riquadro si sposta nell'altra colonna, prima di uno o in fondo", () => {
    const uno = spostaRiquadro(RIQUADRI_DI_SERIE, "byStatus", "destra", "deals");
    expect(uno.sinistra).not.toContain("byStatus");
    expect(uno.destra).toEqual(["unassigned", "byStatus", "deals", "tickets"]);
    const due = spostaRiquadro(uno, "overdue", "destra", null);
    expect(due.destra.at(-1)).toBe("overdue");
  });

  it("nella stessa colonna prende il posto di quello su cui è caduto", () => {
    const out = riordinaRiquadri(RIQUADRI_DI_SERIE, "dueToday", "overdue");
    expect(out.sinistra.slice(0, 2)).toEqual(["dueToday", "overdue"]);
    // colonne diverse: niente
    expect(riordinaRiquadri(RIQUADRI_DI_SERIE, "dueToday", "deals")).toEqual(RIQUADRI_DI_SERIE);
  });

  it("chiudere e riaprire", () => {
    const chiuso = chiudiRiquadro(RIQUADRI_DI_SERIE, "overdue", true);
    expect(chiuso.chiusi.overdue).toBe(true);
    expect(chiudiRiquadro(chiuso, "overdue", false).chiusi.overdue).toBe(false);
  });
});
