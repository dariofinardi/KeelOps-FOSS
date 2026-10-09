import { describe, expect, it } from "vitest";
import {
  messaggioVisibileA,
  nascostoAChiStaFuori,
  puoCifrare,
} from "../src/modules/tasks/comment-visibility";

/**
 * La regola in una tabella: chi guarda × che messaggio. Il file del perimetro
 * (`reserved-comments.test.ts`) prova che ogni rotta la applica; questo prova
 * la regola stessa, senza database.
 */
describe("chi vede quale messaggio della chat", () => {
  const interno = { id: "int", role: "MEMBER" };
  const cliente = { id: "cli", role: "PORTAL" };
  const monitor = { id: "mon", role: "SALES_MONITOR" };
  const normale = { authorId: "int", secret: false, reserved: false };
  const riservato = { authorId: "int", secret: false, reserved: true };
  const cifrato = { authorId: "int", secret: true, reserved: false };
  const cifratoDelCliente = { authorId: "cli", secret: true, reserved: false };

  it("un interno vede tutto", () => {
    for (const m of [normale, riservato, cifrato, cifratoDelCliente]) {
      expect(messaggioVisibileA(interno, m)).toBe(true);
    }
  });

  it("chi sta fuori non vede i riservati né i cifrati", () => {
    for (const fuori of [cliente, monitor]) {
      expect(messaggioVisibileA(fuori, normale)).toBe(true);
      expect(messaggioVisibileA(fuori, riservato)).toBe(false);
      expect(messaggioVisibileA(fuori, cifrato)).toBe(false);
    }
  });

  it("un cifrato resta nascosto a chi sta fuori anche se l'autore risultasse lui", () => {
    // Da fuori `@secret` non si scrive più: se una riga così esistesse (un
    // messaggio storico), resterebbe comunque dentro.
    expect(messaggioVisibileA(cliente, cifratoDelCliente)).toBe(false);
    expect(messaggioVisibileA(monitor, cifratoDelCliente)).toBe(false);
  });

  it("cifrare è un comando degli interni", () => {
    expect(puoCifrare(interno)).toBe(true);
    expect(puoCifrare(cliente)).toBe(false);
    expect(puoCifrare(monitor)).toBe(false);
  });

  it("un messaggio cifrato o riservato non si annuncia a chi sta fuori", () => {
    expect(nascostoAChiStaFuori(normale)).toBe(false);
    expect(nascostoAChiStaFuori(riservato)).toBe(true);
    expect(nascostoAChiStaFuori(cifrato)).toBe(true);
  });
});
