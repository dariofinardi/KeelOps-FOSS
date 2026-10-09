import { describe, expect, it } from "vitest";
import {
  VERSIONE_INFORMATIVA,
  dominioCondiviso,
  etichettaScelta,
  leggiSceltaCookie,
  scriviSceltaCookie,
} from "./consenso-cookie";

/** La scelta sui cookie condivisa fra keelops.it e la demo (18/09/2026). */
describe("il cookie della scelta", () => {
  const scelta = {
    id: "c-1",
    v: VERSIONE_INFORMATIVA,
    s: true,
    m: false,
    t: "2026-09-18T10:00:00.000Z",
  };

  it("si scrive e si rilegge uguale", () => {
    expect(leggiSceltaCookie(scriviSceltaCookie(scelta))).toEqual(scelta);
  });

  it("una versione vecchia, un valore rotto o assente non valgono", () => {
    expect(leggiSceltaCookie(scriviSceltaCookie({ ...scelta, v: "2026-09-12" }))).toBeNull();
    expect(leggiSceltaCookie("%7Bnon-json")).toBeNull();
    expect(leggiSceltaCookie(undefined)).toBeNull();
  });

  it("è il formato che scrive il sito (sito.js): JSON codificato con id, v, s, m, t", () => {
    const dalSito = encodeURIComponent(
      JSON.stringify({ id: "c-x", v: VERSIONE_INFORMATIVA, s: false, m: true, t: "2026-09-18" }),
    );
    expect(leggiSceltaCookie(dalSito)).toMatchObject({ id: "c-x", s: false, m: true });
  });
});

describe("dove vale", () => {
  it("sul sito e sulla demo, il dominio di primo livello; altrove quello dell'host", () => {
    expect(dominioCondiviso("keelops.it")).toBe(".keelops.it");
    expect(dominioCondiviso("demo.keelops.it")).toBe(".keelops.it");
    expect(dominioCondiviso("crm.example.com")).toBeNull();
    expect(dominioCondiviso("localhost")).toBeNull();
    expect(dominioCondiviso("finto-keelops.it")).toBeNull();
  });
});

describe("l'etichetta per il registro", () => {
  it("come sul sito: togliere un sì è una revoca", () => {
    expect(etichettaScelta(null, { s: true, m: true })).toBe("accettato");
    expect(etichettaScelta(null, { s: false, m: false })).toBe("rifiutato");
    expect(etichettaScelta(null, { s: true, m: false })).toBe("parziale");
    expect(etichettaScelta({ s: true, m: false }, { s: false, m: false })).toBe("revocato");
  });
});
