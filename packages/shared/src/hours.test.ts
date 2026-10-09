import { describe, expect, it } from "vitest";
import { formatHours, parseHours, roundHours } from "./hours";

describe("lettura delle ore digitate", () => {
  it("virgola e punto valgono uguale", () => {
    expect(parseHours("4,5")).toBe(4.5);
    expect(parseHours("4.5")).toBe(4.5);
    expect(parseHours("4,2")).toBe(4.2);
  });

  it("accetta le ore intere e gli spazi di troppo", () => {
    expect(parseHours("8")).toBe(8);
    expect(parseHours("  7,5 ")).toBe(7.5);
    expect(parseHours("0,5")).toBe(0.5);
    expect(parseHours(",5")).toBe(0.5);
    expect(parseHours("4,")).toBe(4);
  });

  it("due decimali si scrivono: i quarti d'ora restano quarti d'ora", () => {
    expect(parseHours("0,75")).toBe(0.75);
    expect(parseHours("4,25")).toBe(4.25);
    expect(parseHours("0,04")).toBe(0.04);
  });

  it("oltre il centesimo arrotonda", () => {
    // Più fine di così non si registra: si sceglie il centesimo più vicino.
    expect(parseHours("4,247")).toBe(4.25);
    expect(parseHours("4,244")).toBe(4.24);
    expect(parseHours("0,004")).toBe(0);
  });

  it("la casella vuota vale zero, cioè cancella", () => {
    expect(parseHours("")).toBe(0);
    expect(parseHours("   ")).toBe(0);
  });

  it("quello che non è un monte ore non passa", () => {
    // null e non 0: chi chiama deve poter lasciare il valore com'era invece di
    // azzerare le ore di qualcuno per un carattere sbagliato.
    for (const scritto of ["abc", "-3", "4,5,5", "1e3", "4h", "."]) {
      expect(parseHours(scritto), scritto).toBeNull();
    }
  });

  it("più di ventiquattro ore in un giorno non esistono", () => {
    expect(parseHours("25")).toBeNull();
    expect(parseHours("24")).toBe(24);
  });
});

describe("scrittura delle ore", () => {
  it("in italiano, con la virgola e senza decimali inutili", () => {
    expect(formatHours(4.5)).toBe("4,5");
    expect(formatHours(8)).toBe("8");
    expect(formatHours(0.2)).toBe("0,2");
  });

  it("lo zero lascia la casella vuota", () => {
    expect(formatHours(0)).toBe("");
  });

  it("i decimali sporchi arrivati dal database si ripuliscono", () => {
    // Somme di decimali in binario: 0,1 + 0,2 = 0,30000000000000004.
    expect(formatHours(0.1 + 0.2)).toBe("0,3");
    expect(roundHours(0.1 + 0.2)).toBe(0.3);
  });

  it("i quarti d'ora si leggono come sono, non arrotondati", () => {
    // In produzione ce ne sono migliaia: mostrarli come 0,8 e 2,3 farebbe
    // sballare i totali di colonna, che si sommano sui valori veri.
    expect(formatHours(0.75)).toBe("0,75");
    expect(formatHours(2.25)).toBe("2,25");
    expect(formatHours(4.25)).toBe("4,25");
  });
});
