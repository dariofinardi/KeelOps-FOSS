import { describe, expect, it } from "vitest";
import { dueRangeEnd, inDueRange } from "./due-range";

const OGGI = "2026-08-06";

describe("range di scadenza", () => {
  it("senza range passa tutto, anche chi non ha data", () => {
    expect(inDueRange(null, null, OGGI)).toBe(true);
    expect(inDueRange("2027-01-01", null, OGGI)).toBe(true);
  });

  it("il range tiene dentro gli scaduti e la finestra, fuori il resto", () => {
    expect(inDueRange("2026-07-01", 7, OGGI)).toBe(true); // scaduto: sempre dentro
    expect(inDueRange("2026-08-13", 7, OGGI)).toBe(true); // ultimo giorno incluso
    expect(inDueRange("2026-08-14", 7, OGGI)).toBe(false); // primo fuori
  });

  it("chi non ha data resta DENTRO: il filtro stringe, non nasconde", () => {
    // Prima restava fuori. In una bacheca kanban vedere sparire da una colonna
    // un task senza scadenza si legge come un record perso, non come un
    // filtro che ha funzionato (10/09/2026).
    expect(inDueRange(null, 30, OGGI)).toBe(true);
    expect(inDueRange(null, 7, OGGI)).toBe(true);
  });

  it("la finestra scavalca il cambio mese", () => {
    expect(dueRangeEnd("2026-08-28", 7)).toBe("2026-09-04");
  });
});
