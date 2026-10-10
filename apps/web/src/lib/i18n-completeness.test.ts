// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import en from "@/locales/en.json";
// `it` no: è il nome della funzione di vitest, e l'import la coprirebbe.
import catalogoItaliano from "@/locales/it.json";

/**
 * **Ogni frase che si mostra dev'essere traducibile, e `en.json` completo.**
 *
 * L'italiano è la chiave, quindi una frase senza traduzione non si vede: esce
 * in italiano anche a chi ha scelto l'inglese, e nessuno se ne accorge finché
 * non lo fa un cliente. Fr/de/es possono restare indietro (ricadono
 * sull'italiano di proposito); **l'inglese no**, è il default del prodotto.
 *
 * Il controllo si fa leggendo il sorgente perché è l'unico modo di accorgersene
 * prima del rilascio: una chiave dimenticata non rompe niente a runtime.
 */
const RADICE = path.resolve(import.meta.dirname, "..");

function sorgenti(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((voce) => {
    const completo = path.join(dir, voce.name);
    if (voce.isDirectory()) return voce.name === "locales" ? [] : sorgenti(completo);
    if (!/\.tsx?$/.test(voce.name) || voce.name.includes(".test.")) return [];
    return [completo];
  });
}

/**
 * Via i commenti prima di cercare: la documentazione **parla** di `t()` e di
 * chiavi d'esempio, e prenderle per vere farebbe cercare in catalogo una frase
 * che nessuno mostra. Si tolgono i blocchi `/*…*\/` e le righe che cominciano
 * con `//`; dentro le righe di codice non si taglia niente, o una `//` dentro
 * un indirizzo porterebbe via una chiave vera.
 */
function senzaCommenti(testo: string): string {
  return testo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((riga) => !riga.trimStart().startsWith("//"))
    .join("\n");
}

/** Le chiavi passate a `t("…")` come stringa letterale, già de-escapate. */
function chiaviDi(testo: string): string[] {
  const trovate: string[] = [];
  const regex = /\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  for (const match of testo.matchAll(regex)) {
    const grezza = match[1]!;
    // `JSON.parse` fa da de-escape: `\n` deve tornare un a capo vero, o la
    // chiave non corrisponde a quella scritta nel catalogo.
    try {
      trovate.push(
        grezza.startsWith('"')
          ? (JSON.parse(grezza) as string)
          : (JSON.parse(`"${grezza.slice(1, -1).replace(/"/g, '\\"')}"`) as string),
      );
    } catch {
      // Una stringa che non si sa leggere non è una chiave da controllare.
    }
  }
  return trovate;
}

const CATALOGO = en as Record<string, string>;
const ITALIANO = catalogoItaliano as Record<string, string>;

/** In catalogo, o come chiave secca o nelle due forme plurali. */
const tradotta = (chiave: string) =>
  chiave in CATALOGO || (`${chiave}_one` in CATALOGO && `${chiave}_other` in CATALOGO);

describe("le frasi dell'interfaccia", () => {
  const usate = new Map<string, string>();
  for (const file of sorgenti(RADICE)) {
    for (const chiave of chiaviDi(senzaCommenti(readFileSync(file, "utf8")))) {
      if (!usate.has(chiave)) usate.set(chiave, path.relative(RADICE, file));
    }
  }

  it("ce ne sono, e il controllo le sta davvero leggendo", () => {
    // Una scansione che non trova niente passerebbe sempre.
    expect(usate.size).toBeGreaterThan(1000);
  });

  it("sono tutte in en.json: l'inglese è il default del prodotto", () => {
    const mancanti = [...usate].filter(([chiave]) => !tradotta(chiave));
    expect(mancanti.map(([chiave, dove]) => `${dove}: ${chiave}`)).toEqual([]);
  });

  it("i plurali hanno le due forme in OGNI catalogo, italiano compreso", () => {
    // Senza `_one`/`_other` in italiano, i18next non sceglie la forma e mostra
    // la chiave nuda — con le graffe dentro. E la condizione vale per OGNI
    // chiave usata con {{count}}: la voce secca in catalogo non viene mai
    // consultata quando si passa `count`, quindi non conta come tradotta.
    const senzaForme = [...usate.keys()]
      .filter((chiave) => chiave.includes("{{count}}"))
      .filter((chiave) => !(`${chiave}_one` in CATALOGO && `${chiave}_other` in CATALOGO)
        || !(`${chiave}_one` in ITALIANO && `${chiave}_other` in ITALIANO));
    expect(senzaForme).toEqual([]);
  });
});
