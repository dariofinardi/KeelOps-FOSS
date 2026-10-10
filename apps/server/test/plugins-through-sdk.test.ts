// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Tutti i plugin passano dall'SDK** (regola scritta il 06/09/2026): nessun
 * plugin apre il database per conto suo, legge l'`.env` del core, o parla con
 * Ollama con un `fetch` proprio. Non è una prova di sicurezza — quella è il
 * cancello sul driver e la connessione in sola lettura — ma di disciplina:
 * il giorno che un plugin importa `node:sqlite` o chiama `/api/embed` da sé,
 * questa prova lo dice per nome.
 */
const pluginsDir = path.resolve(import.meta.dirname, "../../../plugins");
/**
 * `ui` NON si salta più (09/09/2026): l'interfaccia di un plugin è un'
 * applicazione come le altre, e il difetto degli script inline stava proprio
 * lì — questa prova passava mentre la produzione era rotta. Si saltano invece
 * `dist` e i moduli, che sono roba costruita.
 */
const SKIP = new Set(["keelops-sdk", "node_modules", "dist", "vendors", "motore", "native", "data", "test"]);
const PERMESSI_NEI_TEST = /(^|\/)(selftest|server)\.mjs$|(^|\/)test\//;

function sorgenti(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (SKIP.has(nome) || nome.startsWith(".")) continue;
    const p = path.join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) sorgenti(p, out);
    else if (/\.(mjs|js|ts|tsx)$/.test(nome)) out.push(p);
  }
  return out;
}

const PROIBITI: [RegExp, string][] = [
  [/from\s+["']node:sqlite["']/, "apre il database da sé (node:sqlite)"],
  [/from\s+["']better-sqlite3["']/, "apre il database da sé (better-sqlite3)"],
  [/from\s+["']@prisma\/client["']/, "usa Prisma direttamente"],
  [/from\s+["']mariadb["']/, "usa il client MariaDB direttamente"],
  [/\/api\/embed|\/api\/chat|\/api\/generate/, "parla con Ollama senza passare da keelops-sdk/ollama.mjs"],
  [/process\.env\.(DATABASE_URL|DATABASE_PATH|GOOGLE_CLIENT_SECRET|OLLAMA_URL)/, "legge l'ambiente del core"],
  /**
   * **Niente script inline in una pagina di plugin.**
   *
   * In produzione la CSP è `script-src 'self'`: un `<script>` col codice
   * dentro non viene eseguito. In sviluppo la CSP è spenta, quindi funziona —
   * ed è il motivo per cui il difetto è arrivato in produzione in tre plugin
   * su cinque, ogni volta scoperto da un errore in console di qualcun altro
   * (09/09/2026). Il guscio serve gli script dell'SDK come file per tutti:
   * `<script src="sdk/tema.js" defer></script>`.
   */
  [/<script>\$\{/, "mette uno script inline in pagina: in produzione la CSP non lo esegue (usa sdk/tema.js)"],
  [/createElement\(["']script["']\)/, "costruisce uno script inline: chiamalo come funzione, o usa sdk/riquadro.js"],
];

describe("i plugin passano dall'SDK", () => {
  const cartelle = readdirSync(pluginsDir).filter(
    (n) => !SKIP.has(n) && statSync(path.join(pluginsDir, n)).isDirectory(),
  );
  it("ci sono plugin da controllare", () => {
    expect(cartelle.length).toBeGreaterThan(0);
  });
  for (const plugin of cartelle) {
    it(`${plugin}: nessun accesso diretto al database, all'ambiente o a Ollama`, () => {
      const violazioni: string[] = [];
      for (const file of sorgenti(path.join(pluginsDir, plugin))) {
        // il modo autonomo e le prove aprono la COPIA del database: è il loro mestiere
        if (PERMESSI_NEI_TEST.test(path.relative(pluginsDir, file))) continue;
        const testo = readFileSync(file, "utf8");
        for (const [re, perche] of PROIBITI) {
          if (re.test(testo)) violazioni.push(`${path.relative(pluginsDir, file)}: ${perche}`);
        }
      }
      expect(violazioni).toEqual([]);
    });
  }
});
