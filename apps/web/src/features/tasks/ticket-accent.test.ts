import { describe, expect, it } from "vitest";
import { TicketPriority } from "@kancrm/shared";
import { ticketAccent } from "./ticket-accent";

const task = (
  over: Partial<{ createdViaTicket: boolean; ticketPriority: TicketPriority | null }>,
) =>
  ({ createdViaTicket: true, ticketPriority: TicketPriority.MEDIUM, ...over }) as Parameters<
    typeof ticketAccent
  >[0];

describe("colore delle richieste da ticket", () => {
  it("un task normale non prende nessun colore", () => {
    // Il segno deve restare raro, o non è più un segno: lo portano solo le
    // richieste, che sono le uniche con un'urgenza dichiarata da fuori.
    expect(ticketAccent(task({ createdViaTicket: false }))).toBeNull();
    expect(ticketAccent(task({ createdViaTicket: false, ticketPriority: null }))).toBeNull();
  });

  it("rosso alta, arancione media, blu notte bassa", () => {
    expect(ticketAccent(task({ ticketPriority: TicketPriority.HIGH })!)!.border).toContain("red");
    expect(ticketAccent(task({ ticketPriority: TicketPriority.MEDIUM }))!.border).toContain(
      "orange",
    );
    expect(ticketAccent(task({ ticketPriority: TicketPriority.LOW }))!.border).toContain("blue");
  });

  it("una richiesta senza priorità vale come media, non come 'non è un ticket'", () => {
    // I dati storici (o un import) possono non averla: senza colore direbbero
    // il falso, cioè che non arrivano da un ticket.
    expect(ticketAccent(task({ ticketPriority: null }))).toEqual(
      ticketAccent(task({ ticketPriority: TicketPriority.MEDIUM })),
    );
  });

  it("ogni priorità ha il filo per le righe e il bordo per le card, con la variante scura", () => {
    for (const priority of Object.values(TicketPriority)) {
      const accent = ticketAccent(task({ ticketPriority: priority }))!;
      expect(accent.left, priority).toContain("border-l-4");
      // Senza variante scura il blu notte sparisce nel fondo del tema scuro.
      expect(accent.border, priority).toContain("dark:");
      expect(accent.left, priority).toContain("dark:");
      expect(accent.titleKey, priority).toContain("Richiesta da ticket");
    }
  });
});
