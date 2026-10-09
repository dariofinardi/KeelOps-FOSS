import { describe, expect, it } from "vitest";
import { destinoEmail } from "../src/modules/notifications/email-queue";

/**
 * **Il destino dell'email di un avviso** (25/09/2026): la regola pura che usano
 * i due giri della coda. Il caso che l'ha fatta nascere: chi ha già letto
 * l'avviso nella campanella non deve ritrovarselo in posta.
 */
const GIOVEDI = new Date("2026-09-24T10:00:00Z");
const SABATO = new Date("2026-09-26T10:00:00Z");
const minuti = (da: Date, n: number) => new Date(da.getTime() + n * 60_000);
const persona = { emailDigest: false, emailWeekend: false };
const avviso = (createdAt: Date, extra: { readAt?: Date; inApp?: boolean } = {}) => ({
  readAt: extra.readAt ?? null,
  inApp: extra.inApp ?? true,
  createdAt,
});

describe("destinoEmail", () => {
  it("letto: l'email non serve più, a qualunque ora", () => {
    expect(
      destinoEmail(avviso(GIOVEDI, { readAt: GIOVEDI }), persona, minuti(GIOVEDI, 60), 15),
    ).toBe("scarta");
  });

  it("non letto: aspetta l'attesa, poi parte da solo", () => {
    expect(destinoEmail(avviso(GIOVEDI), persona, minuti(GIOVEDI, 14), 15)).toBe("aspetta");
    expect(destinoEmail(avviso(GIOVEDI), persona, minuti(GIOVEDI, 15), 15)).toBe("singola");
  });

  it("senza campanella per quel tipo non c'è niente da aspettare", () => {
    expect(destinoEmail(avviso(GIOVEDI, { inApp: false }), persona, GIOVEDI, 15)).toBe("singola");
  });

  it("chi aggrega lo riceve nel riepilogo, anche lui dopo l'attesa", () => {
    const aggrega = { emailDigest: true, emailWeekend: false };
    expect(destinoEmail(avviso(GIOVEDI), aggrega, minuti(GIOVEDI, 5), 15)).toBe("aspetta");
    expect(destinoEmail(avviso(GIOVEDI), aggrega, minuti(GIOVEDI, 20), 15)).toBe("riepilogo");
  });

  it("nel weekend aspetta; il lunedì quelli del weekend vanno nel riepilogo", () => {
    expect(destinoEmail(avviso(SABATO), persona, minuti(SABATO, 60), 15)).toBe("aspetta");
    const lunedi = new Date("2026-09-28T06:00:00Z");
    expect(destinoEmail(avviso(SABATO), persona, lunedi, 15)).toBe("riepilogo");
    // chi le vuole anche nel weekend le riceve una per una
    expect(
      destinoEmail(
        avviso(SABATO),
        { emailDigest: false, emailWeekend: true },
        minuti(SABATO, 20),
        15,
      ),
    ).toBe("singola");
  });

  it("con attesa zero parte subito, come prima", () => {
    expect(destinoEmail(avviso(GIOVEDI), persona, GIOVEDI, 0)).toBe("singola");
  });

  it("il portale clienti resta com'era: niente attesa, niente scarto", () => {
    // Scelta del committente (25/09/2026): la novità è dell'applicazione interna.
    const cliente = { emailDigest: true, emailWeekend: false, role: "PORTAL" };
    expect(destinoEmail(avviso(GIOVEDI, { readAt: GIOVEDI }), cliente, GIOVEDI, 15)).toBe(
      "riepilogo",
    );
    expect(destinoEmail(avviso(SABATO), cliente, minuti(SABATO, 60), 15)).toBe("aspetta");
  });
});
