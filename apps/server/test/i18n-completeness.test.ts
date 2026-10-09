import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import en from "../src/i18n/catalogs/en.json";
import catalogoItaliano from "../src/i18n/catalogs/it.json";

/**
 * **Le frasi che il server manda fuori devono essere tradotte.**
 *
 * Notifiche, email e messaggi d'errore escono nella lingua di chi li riceve, e
 * l'italiano è la chiave: una frase mai messa in catalogo non rompe niente —
 * arriva semplicemente in italiano a un destinatario francese, e nessuno se ne
 * accorge finché non è un cliente. Il 20/08/2026 erano tredici, tutte
 * nell'email della nota di rilascio e nell'avviso WIP.
 *
 * Gemello di `apps/web/src/lib/i18n-completeness.test.ts`.
 */
const RADICE = path.resolve(import.meta.dirname, "../src");

function sorgenti(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((voce) => {
    const completo = path.join(dir, voce.name);
    if (voce.isDirectory()) return voce.name === "catalogs" ? [] : sorgenti(completo);
    return voce.name.endsWith(".ts") ? [completo] : [];
  });
}

/** Via i commenti: la documentazione parla di `t()` e di chiavi d'esempio. */
const senzaCommenti = (testo: string) =>
  testo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((riga) => !riga.trimStart().startsWith("//"))
    .join("\n");

/**
 * `serverT(locale, "…")` e le `t("…")` dei costruttori di messaggi. Anche con
 * gli apici SINGOLI: le chiavi che contengono virgolette si scrivono così, e
 * proprio cinque di quelle erano sfuggite al controllo (23/08/2026).
 */
function chiaviDi(testo: string): string[] {
  const regex = /\b(?:serverT\(\s*[^,]+,|t\()\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  return [...testo.matchAll(regex)].flatMap((match) => {
    const grezza = match[1]!;
    try {
      return grezza.startsWith('"')
        ? [JSON.parse(grezza) as string]
        : [JSON.parse(`"${grezza.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string];
    } catch {
      return [];
    }
  });
}

const CATALOGO = en as Record<string, string>;
const ITALIANO = catalogoItaliano as Record<string, string>;
const tradotta = (chiave: string) =>
  chiave in CATALOGO || (`${chiave}_one` in CATALOGO && `${chiave}_other` in CATALOGO);

describe("le frasi che il server manda fuori", () => {
  const usate = new Map<string, string>();
  for (const file of sorgenti(RADICE)) {
    for (const chiave of chiaviDi(senzaCommenti(readFileSync(file, "utf8")))) {
      if (!usate.has(chiave)) usate.set(chiave, path.relative(RADICE, file));
    }
  }

  it("il controllo le sta davvero leggendo", () => {
    expect(usate.size).toBeGreaterThan(30);
  });

  it("sono tutte in en.json", () => {
    const mancanti = [...usate].filter(([chiave]) => !tradotta(chiave));
    expect(mancanti.map(([chiave, dove]) => `${dove}: ${chiave}`)).toEqual([]);
  });

  it("i plurali hanno le due forme anche in italiano", () => {
    // OGNI chiave usata con {{count}} è un plurale: `serverT` con `count` cerca
    // solo `_one`/`_other`, quindi la voce secca in catalogo è lettera morta —
    // sembrava tradotta e usciva in italiano (23/08/2026).
    const senzaForme = [...usate.keys()]
      .filter((chiave) => chiave.includes("{{count}}"))
      .filter((chiave) => !(`${chiave}_one` in CATALOGO && `${chiave}_other` in CATALOGO)
        || !(`${chiave}_one` in ITALIANO && `${chiave}_other` in ITALIANO));
    expect(senzaForme).toEqual([]);
  });
});
