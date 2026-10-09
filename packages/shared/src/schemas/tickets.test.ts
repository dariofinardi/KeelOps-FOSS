import { describe, expect, it } from "vitest";
import { TicketPriority } from "../enums";
import { isPriorityRise } from "./tickets";

/**
 * "La priorità è salita" non si legge dal valore — in banca dati è la parola
 * `LOW|MEDIUM|HIGH` — e da quella domanda dipende se chi ci lavora viene
 * avvisato che la sua giornata è cambiata (17/08/2026).
 */
describe("isPriorityRise", () => {
  it("riconosce le salite", () => {
    expect(isPriorityRise(TicketPriority.LOW, TicketPriority.MEDIUM)).toBe(true);
    expect(isPriorityRise(TicketPriority.LOW, TicketPriority.HIGH)).toBe(true);
    expect(isPriorityRise(TicketPriority.MEDIUM, TicketPriority.HIGH)).toBe(true);
  });

  it("le discese e i pari non sono salite", () => {
    expect(isPriorityRise(TicketPriority.HIGH, TicketPriority.MEDIUM)).toBe(false);
    expect(isPriorityRise(TicketPriority.MEDIUM, TicketPriority.LOW)).toBe(false);
    expect(isPriorityRise(TicketPriority.HIGH, TicketPriority.HIGH)).toBe(false);
  });

  it("una priorità mai scritta vale media, come in tutta l'applicazione", () => {
    // Lo storico importato non ha la priorità: passare a "alta" È una salita,
    // passare a "bassa" no.
    expect(isPriorityRise(null, TicketPriority.HIGH)).toBe(true);
    expect(isPriorityRise(undefined, TicketPriority.HIGH)).toBe(true);
    expect(isPriorityRise(null, TicketPriority.LOW)).toBe(false);
    expect(isPriorityRise(null, TicketPriority.MEDIUM)).toBe(false);
  });
});
