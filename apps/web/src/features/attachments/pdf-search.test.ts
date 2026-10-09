import { describe, expect, it } from "vitest";
import {
  cercaInPagina,
  cercaNelDocumento,
  giraIndice,
  normalizzaPerRicerca,
  paginaValida,
} from "./pdf-search";

describe("normalizzaPerRicerca", () => {
  it("toglie maiuscole e accenti senza cambiare la lunghezza", () => {
    expect(normalizzaPerRicerca("Città PERCHÉ")).toBe("citta perche");
    expect(normalizzaPerRicerca("Città").length).toBe("Città".length);
  });

  it("lascia com'è ciò che non sa ridurre a un carattere", () => {
    const testo = "ok 🚀 İ";
    expect(normalizzaPerRicerca(testo).length).toBe(testo.length);
  });
});

describe("cercaInPagina", () => {
  it("trova ogni occorrenza dentro un pezzo, senza badare a maiuscole e accenti", () => {
    const trovate = cercaInPagina([{ str: "Rilascio della città, CITTA nuova" }], "citta", 3);
    expect(trovate).toEqual([
      { pagina: 3, parti: [{ pezzo: 0, da: 15, a: 20 }] },
      { pagina: 3, parti: [{ pezzo: 0, da: 22, a: 27 }] },
    ]);
  });

  it("una parola a cavallo di due pezzi torna in due tratti", () => {
    const trovate = cercaInPagina(
      [{ str: "note di rilasc" }, { str: "io settimanali" }],
      "rilascio",
      1,
    );
    expect(trovate).toEqual([
      {
        pagina: 1,
        parti: [
          { pezzo: 0, da: 8, a: 14 },
          { pezzo: 1, da: 0, a: 2 },
        ],
      },
    ]);
  });

  it("la fine riga vale uno spazio, e gli spazi cercati si compattano", () => {
    const pezzi = [{ str: "nota di", hasEOL: true }, { str: "rilascio" }];
    const [m] = cercaInPagina(pezzi, "  di   rilascio ", 1);
    expect(m?.parti).toEqual([
      { pezzo: 0, da: 5, a: 7 },
      { pezzo: 1, da: 0, a: 8 },
    ]);
  });

  it("una ricerca vuota non trova niente", () => {
    expect(cercaInPagina([{ str: "testo" }], "   ", 1)).toEqual([]);
  });
});

describe("cercaNelDocumento", () => {
  it("numera le pagine da 1 e le tiene in ordine", () => {
    const trovate = cercaNelDocumento([[{ str: "alfa" }], [], [{ str: "beta alfa" }]], "alfa");
    expect(trovate.map((m) => m.pagina)).toEqual([1, 3]);
  });
});

describe("giraIndice e paginaValida", () => {
  it("il risultato dopo l'ultimo è il primo, e viceversa", () => {
    expect(giraIndice(-1, 3, 1)).toBe(0);
    expect(giraIndice(-1, 3, -1)).toBe(2);
    expect(giraIndice(2, 3, 1)).toBe(0);
    expect(giraIndice(0, 3, -1)).toBe(2);
    expect(giraIndice(0, 0, 1)).toBe(-1);
  });

  it("una pagina scritta fuori dal documento torna dentro", () => {
    expect(paginaValida(0, 5)).toBe(1);
    expect(paginaValida(9, 5)).toBe(5);
    expect(paginaValida(Number.NaN, 5)).toBe(1);
    expect(paginaValida(2.6, 5)).toBe(3);
  });
});
