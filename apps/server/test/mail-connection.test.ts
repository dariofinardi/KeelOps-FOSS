import { describe, expect, it } from "vitest";
import { smtpHandshake } from "../src/modules/mail/connection";

describe("stretta di mano SMTP", () => {
  it("sulla 465 il cifrato parte dal primo byte", () => {
    expect(smtpHandshake(465, true)).toEqual({ secure: true, requireTLS: false });
    // Anche senza chiederlo: su quella porta non esiste un dialogo in chiaro.
    expect(smtpHandshake(465, false)).toEqual({ secure: true, requireTLS: false });
  });

  it("sulla 587 si parte in chiaro e si sale con STARTTLS", () => {
    // È il caso che rompeva l'invio: con `secure: true` la libreria prova a
    // leggere come TLS una risposta in chiaro e fallisce con
    // "wrong version number" — un errore che non dice niente a chi lo legge.
    expect(smtpHandshake(587, true)).toEqual({ secure: false, requireTLS: true });
  });

  it("chi non pretende il cifrato non lo impone, ma nemmeno lo vieta", () => {
    expect(smtpHandshake(587, false)).toEqual({ secure: false, requireTLS: false });
    expect(smtpHandshake(25, false)).toEqual({ secure: false, requireTLS: false });
  });
});
