import { describe, expect, it } from "vitest";
import {
  isValidPeriod,
  monthOfPeriod,
  periodDays,
  periodKind,
  periodMonths,
  periodRange,
  shiftPeriod,
  toMonthPeriod,
  toWeekPeriod,
  weekStartOf,
} from "./timesheet-period";

describe("periodo del timesheet", () => {
  it("distingue mese e settimana dalla forma della chiave", () => {
    expect(periodKind("2026-08")).toBe("month");
    expect(periodKind("2026-08-03")).toBe("week");
  });

  it("la settimana si identifica col suo lunedì, e solo con quello", () => {
    // Due chiavi per la stessa settimana vorrebbero dire due righe tenute a
    // mano per lo stesso task.
    expect(isValidPeriod("2026-08-03")).toBe(true); // lunedì
    expect(isValidPeriod("2026-08-05")).toBe(false); // mercoledì
    expect(isValidPeriod("2026-08")).toBe(true);
    expect(isValidPeriod("agosto")).toBe(false);
  });

  it("il lunedì della settimana, domenica compresa", () => {
    expect(weekStartOf("2026-08-05")).toBe("2026-08-03"); // mercoledì → lunedì
    expect(weekStartOf("2026-08-03")).toBe("2026-08-03");
    // La domenica chiude la settimana, non ne apre una nuova.
    expect(weekStartOf("2026-08-09")).toBe("2026-08-03");
    expect(weekStartOf("2026-08-10")).toBe("2026-08-10");
  });

  it("i giorni: sette per la settimana, quanti ne ha il mese per il mese", () => {
    expect(periodDays("2026-08-03")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
    expect(periodDays("2026-08")).toHaveLength(31);
    expect(periodDays("2026-02")).toHaveLength(28);
    expect(periodDays("2028-02")).toHaveLength(29); // bisestile
  });

  it("l'intervallo ha la fine esclusa (come le query sulle date)", () => {
    expect(periodRange("2026-08-03")).toEqual({ from: "2026-08-03", toExclusive: "2026-08-10" });
    expect(periodRange("2026-08")).toEqual({ from: "2026-08-01", toExclusive: "2026-09-01" });
    expect(periodRange("2026-12")).toEqual({ from: "2026-12-01", toExclusive: "2027-01-01" });
  });

  it("la settimana a cavallo tocca DUE mesi: i lucchetti valgono per entrambi", () => {
    // 31 agosto 2026 è un lunedì: la settimana finisce il 6 settembre.
    expect(periodMonths("2026-08-31")).toEqual(["2026-08", "2026-09"]);
    expect(periodMonths("2026-08-03")).toEqual(["2026-08"]);
    expect(periodMonths("2026-08")).toEqual(["2026-08"]);
  });

  it("il mese di appartenenza di una settimana a cavallo è quello del giovedì", () => {
    // Regola ISO: la settimana del 31 agosto (giovedì 3 settembre) è di settembre.
    expect(monthOfPeriod("2026-08-31")).toBe("2026-09");
    // …e quella del 27 luglio (giovedì 30 luglio) resta di luglio.
    expect(monthOfPeriod("2026-07-27")).toBe("2026-07");
    expect(monthOfPeriod("2026-08")).toBe("2026-08");
    expect(toMonthPeriod("2026-08-03")).toBe("2026-08");
  });

  it("avanti e indietro: di un mese o di una settimana, secondo la lente", () => {
    expect(shiftPeriod("2026-08", 1)).toBe("2026-09");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-08-03", 1)).toBe("2026-08-10");
    expect(shiftPeriod("2026-08-31", 1)).toBe("2026-09-07");
    expect(shiftPeriod("2026-08-03", -1)).toBe("2026-07-27");
  });

  it("passando a settimana si resta dove si sta guardando", () => {
    // Mese corrente → la settimana di oggi: è lì che si sta rendicontando.
    expect(toWeekPeriod("2026-08", "2026-08-12")).toBe("2026-08-10");
    // Mese diverso → la prima settimana che comincia in quel mese.
    expect(toWeekPeriod("2026-09", "2026-08-12")).toBe("2026-09-07");
    // Se il 1° è già lunedì, è quella la prima.
    expect(toWeekPeriod("2026-06", "2026-08-12")).toBe("2026-06-01");
    // Una settimana resta sé stessa.
    expect(toWeekPeriod("2026-08-03", "2026-08-12")).toBe("2026-08-03");
  });
});
