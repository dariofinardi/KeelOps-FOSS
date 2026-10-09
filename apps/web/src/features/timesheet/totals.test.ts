import { describe, expect, it } from "vitest";
import type { TimesheetRow } from "@kancrm/shared";
import { cellHours, cellKey, dayFlag, dayTotals, monthTotal } from "./totals";

const riga = (id: string, entries: Record<string, number>): TimesheetRow =>
  ({
    task: { id, title: id, context: "KanCRM" },
    entries,
    total: Object.values(entries).reduce((a, b) => a + b, 0),
  }) as TimesheetRow;

const giorni = ["2026-08-03", "2026-08-04", "2026-08-05"];
const righe = [riga("t1", { "2026-08-03": 4, "2026-08-04": 8 }), riga("t2", { "2026-08-03": 3.5 })];

describe("totali del timesheet", () => {
  it("somma le colonne e il mese", () => {
    expect(dayTotals(righe, giorni)).toEqual([7.5, 8, 0]);
    expect(monthTotal(dayTotals(righe, giorni))).toBe(15.5);
  });

  it("le ore che si stanno scrivendo contano subito", () => {
    // È il motivo del piede sempre aggiornato: ci si accorge dello sbaglio
    // mentre lo si fa, non dopo il salvataggio.
    const drafts = { [cellKey("t2", "2026-08-03")]: 6 };
    expect(dayTotals(righe, giorni, drafts)).toEqual([10, 8, 0]);
    expect(cellHours(righe[1]!, "2026-08-03", drafts)).toBe(6);
  });

  it("una casella svuotata mentre si scrive vale zero, non il vecchio valore", () => {
    const drafts = { [cellKey("t1", "2026-08-04")]: 0 };
    expect(dayTotals(righe, giorni, drafts)).toEqual([7.5, 0, 0]);
  });

  it("segnala la giornata che non torna", () => {
    expect(dayFlag(7.5)).toBe("ok");
    expect(dayFlag(8)).toBe("ok");
    expect(dayFlag(9)).toBe("oltre");
    expect(dayFlag(25)).toBe("impossibile"); // oltre le ore che ha un giorno
  });

  it("con più colleghi a schermo la soglia cresce con loro", () => {
    // Tre persone da 8 ore fanno 24: normale, non un errore di battitura.
    expect(dayFlag(24, 3)).toBe("ok");
    expect(dayFlag(25, 3)).toBe("oltre");
  });
});
