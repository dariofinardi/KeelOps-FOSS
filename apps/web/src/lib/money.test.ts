import { describe, expect, it } from "vitest";
import { makeMoneyFormatter } from "./money";

/** Intl separa numero e simbolo con uno spazio unificatore: qui si normalizza. */
const pulito = (s: string) => s.replace(/\u00a0/g, " ");

describe("makeMoneyFormatter", () => {
  it("mette il punto delle migliaia anche a quattro cifre", () => {
    // I dati CLDR per l'italiano non raggruppano sotto le cinque cifre
    // (minimumGroupingDigits = 2): senza "always", 4540 resta "4540 €" mentre
    // 45400 diventa "45.400 €" — due convenzioni nella stessa pagina.
    expect(pulito(makeMoneyFormatter("EUR").format(4540))).toBe("4.540 €");
    expect(pulito(makeMoneyFormatter("EUR").format(45400))).toBe("45.400 €");
  });

  it("sotto le mille: niente separatore e niente decimali", () => {
    expect(pulito(makeMoneyFormatter("EUR").format(800))).toBe("800 €");
  });

  it("usa il codice valuta valido fornito", () => {
    expect(makeMoneyFormatter("USD").format(10)).toMatch(/USD|\$/);
  });

  it("ripiega su EUR con un codice valuta non valido", () => {
    // "XX" non è un codice ISO 4217 valido: Intl lancia, il formatter ripiega su EUR.
    expect(pulito(makeMoneyFormatter("XX").format(4540))).toBe("4.540 €");
  });
});
