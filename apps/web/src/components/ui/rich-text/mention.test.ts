import { describe, expect, it } from "vitest";
import { matchPeople } from "./mention";

const persone = [
  { id: "1", name: "Dario Ferri" },
  { id: "2", name: "Francesca Cavazzoni" },
  { id: "3", name: "Giacomo Verdi" },
  { id: "4", name: "Emanuele Bassi" },
];

describe("chi proporre dopo la chiocciola", () => {
  it("senza aver ancora scritto niente, propone tutti", () => {
    expect(matchPeople(persone, "")).toHaveLength(4);
  });

  it("cerca dentro il nome, non solo all'inizio", () => {
    // Si scrive "@verdi" tanto quanto "@giacomo": il cognome è un modo
    // altrettanto naturale di chiamare qualcuno.
    expect(matchPeople(persone, "verdi").map((p) => p.name)).toEqual(["Giacomo Verdi"]);
    expect(matchPeople(persone, "fra").map((p) => p.name)).toEqual(["Francesca Cavazzoni"]);
  });

  it("non guarda le maiuscole né gli spazi di troppo", () => {
    expect(matchPeople(persone, "  DARIO ").map((p) => p.name)).toEqual(["Dario Ferri"]);
  });

  it("chi non c'è non compare, e l'elenco resta vuoto", () => {
    expect(matchPeople(persone, "zzz")).toEqual([]);
  });

  it("non allunga la lista oltre quello che si legge a colpo d'occhio", () => {
    const tanti = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `Persona ${i}` }));
    expect(matchPeople(tanti, "persona")).toHaveLength(8);
  });
});
