import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Le pagine dei plugin sono tradotte in tutte le lingue del prodotto**
 * (22/09/2026). La verifica di quel giorno ha trovato un plugin che mostrava
 * l'inglese a chi aveva scelto francese, tedesco o spagnolo, due frasi di un
 * altro rimaste in italiano per tutti, e una ventina di frasi mancanti in tre
 * lingue di altri due. Nessun guasto: solo pagine a metà, che nessuno vede
 * finché non le apre qualcuno di un altro paese.
 *
 * Questa prova fa quella verifica ogni volta: per ogni plugin che trova in
 * `plugins/` (anche quelli collegati da fuori, quando ci sono) legge il suo
 * catalogo, raccoglie le frasi che le sue pagine passano a `t()`, e pretende
 * ciascuna in en, fr, de, es e pt (il portoghese dal 09/10/2026).
 */
const pluginsDir = path.resolve(import.meta.dirname, "../../../plugins");
const CATALOGHI = ["ui/i18n.js", "ui/src/i18n.ts", "lib/i18n.mjs"];
const SALTA = new Set(["node_modules", "dist", "test", "vendors", "data"]);
const LINGUE = ["en", "fr", "de", "es", "pt"] as const;

function sorgenti(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const nome of readdirSync(dir)) {
    if (SALTA.has(nome) || nome.startsWith(".")) continue;
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) sorgenti(p, out);
    else if (/\.(js|mjs|ts|tsx|html)$/.test(nome)) out.push(p);
  }
  return out;
}

/** I blocchi di un catalogo: `const FR: … = {…}` oppure `fr: {…}`. */
function blocchi(testo: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const prendi = (lingua: string, da: number) => {
    let profondita = 0;
    let fine = da;
    for (; fine < testo.length; fine++) {
      if (testo[fine] === "{") profondita++;
      else if (testo[fine] === "}" && --profondita === 0) break;
    }
    out[lingua] = new Function(`return (${testo.slice(da, fine + 1)})`)() as Record<string, string>;
  };
  for (const m of testo.matchAll(/const (EN|FR|DE|ES|PT)\s*(?::[^=]+)?=\s*\{/g)) {
    prendi(m[1]!.toLowerCase(), m.index! + m[0].length - 1);
  }
  for (const m of testo.matchAll(/\n\s{2,6}(en|fr|de|es|pt):\s*\{/g)) {
    if (!out[m[1]!]) prendi(m[1]!, m.index! + m[0].length - 1);
  }
  return out;
}

function frasiUsate(dir: string, catalogo: string): Set<string> {
  const usate = new Set<string>();
  for (const file of sorgenti(dir)) {
    if (file === catalogo) continue;
    const testo = readFileSync(file, "utf8");
    for (const m of testo.matchAll(/\bt\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
      usate.add(m[2]!.replace(/\\(["'])/g, "$1"));
    }
    for (const m of testo.matchAll(/data-i18n(?:-title|-placeholder)?="([^"$]+)"/g)) usate.add(m[1]!);
  }
  return usate;
}

const plugins = readdirSync(pluginsDir)
  .map((nome) => ({ nome, dir: path.join(pluginsDir, nome) }))
  .filter(({ dir }) => existsSync(dir) && statSync(dir).isDirectory())
  .map((p) => ({ ...p, catalogo: CATALOGHI.map((c) => path.join(p.dir, c)).find((c) => existsSync(c)) }))
  .filter((p): p is { nome: string; dir: string; catalogo: string } => Boolean(p.catalogo));

describe("le traduzioni delle pagine dei plugin", () => {
  it("ci sono plugin con un catalogo da controllare", () => {
    expect(plugins.length).toBeGreaterThan(0);
  });

  for (const plugin of plugins) {
    const cataloghi = blocchi(readFileSync(plugin.catalogo, "utf8"));
    const usate = frasiUsate(plugin.dir, plugin.catalogo);
    for (const lingua of LINGUE) {
      it(`${plugin.nome}: ${lingua} ha tutte le frasi della pagina`, () => {
        expect(cataloghi[lingua], `manca il catalogo ${lingua}`).toBeDefined();
        const mancanti = [...usate].filter((k) => !(k in cataloghi[lingua]!));
        expect(mancanti).toEqual([]);
      });
    }
  }
});
