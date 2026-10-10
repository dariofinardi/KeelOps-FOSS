// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../../config";
import { prisma } from "../../db";
import { SESSION_COOKIE, findSessionUser } from "../auth/session";

/**
 * **I colori di KeelOps, serviti ai plugin** (07/09/2026).
 *
 * Una pagina di plugin vive in un iframe della stessa origine, ma con un suo
 * documento: non eredita niente dal foglio di stile dell'applicazione. Aveva
 * quindi una tavolozza sua — simile, non uguale — e soprattutto seguiva il
 * tema del **sistema operativo**, mentre l'applicazione segue quello **scelto
 * dall'utente**: chi lavorava in chiaro con il sistema in scuro vedeva i
 * riquadri dei plugin neri dentro una pagina bianca.
 *
 * Qui il core serve la stessa sorgente dell'applicazione
 * (`packages/shared/src/tema.css`) **già risolta** per chi la chiede:
 *
 *  - `light` → i soli valori chiari;
 *  - `dark` → chiari più gli scuri applicati sempre;
 *  - `auto` → chiari più gli scuri dentro `prefers-color-scheme`, che è la
 *    stessa cosa che fa l'applicazione seguendo il sistema in tempo reale;
 *  - `company` → chiari più l'accento aziendale.
 *
 * Senza sessione (una pagina di plugin aperta da sola) vale `auto`: è il
 * comportamento di prima, e non rivela niente di nessuno.
 */
const SORGENTE = () => path.join(config.rootDir, "packages", "shared", "src", "tema.css");

/** Le tre parti del file: la base, la faccia scura, gli accenti aziendali. */
interface Pezzi {
  base: string;
  scuro: string;
  aziendali: Map<string, string>;
}

let cache: { pezzi: Pezzi; impronta: string } | null = null;

/** Estrae il corpo di una regola (`.dark { … }`) senza interpretare il CSS. */
function corpoDi(css: string, selettore: string): string {
  const inizio = css.indexOf(`${selettore} {`);
  if (inizio < 0) return "";
  const apertura = css.indexOf("{", inizio);
  const chiusura = css.indexOf("\n}", apertura);
  return css.slice(apertura + 1, chiusura).trim();
}

export function leggiPezzi(): Pezzi {
  const percorso = SORGENTE();
  const testo = readFileSync(percorso, "utf8");
  const impronta = String(testo.length);
  if (cache && cache.impronta === impronta) return cache.pezzi;
  const aziendali = new Map<string, string>();
  for (const match of testo.matchAll(/^\.theme-([a-z0-9-]+) \{/gm)) {
    aziendali.set(match[1]!, corpoDi(testo, `.theme-${match[1]!}`));
  }
  const pezzi: Pezzi = {
    base: corpoDi(testo, ":root"),
    scuro: corpoDi(testo, ".dark"),
    aziendali,
  };
  cache = { pezzi, impronta };
  return pezzi;
}

/**
 * Il foglio di stile per un tema già scelto. Esportato perché si prova da solo.
 *
 * Tre strati, nell'ordine in cui vincono:
 *
 *  1. i valori chiari su `:root`, sempre;
 *  2. gli scuri quando la scelta è «scuro», o dentro `prefers-color-scheme`
 *    quando è «automatico» — e non si applicano se la pagina ha già dichiarato
 *    `data-tema="light"`;
 *  3. gli scuri su `[data-tema="dark"]`, che è quello che scrive lo script
 *    dell'SDK guardando l'applicazione che ospita la pagina: dentro un
 *    riquadro comanda quello che la persona sta vedendo adesso, non quello che
 *    dice il sistema operativo o il profilo salvato.
 */
export function temaCss(tema: string, temaAziendale: string): string {
  const { base, scuro, aziendali } = leggiPezzi();
  const righe = [
    "/* I colori di KeelOps. Generato da packages/shared/src/tema.css. */",
    `:root {\n${base}\n}`,
  ];
  if (tema === "dark") righe.push(`:root:not([data-tema="light"]) {\n${scuro}\n}`);
  else if (tema === "company" && aziendali.has(temaAziendale))
    righe.push(`:root {\n${aziendali.get(temaAziendale)!}\n}`);
  else if (tema !== "light")
    righe.push(
      `@media (prefers-color-scheme: dark) {\n  :root:not([data-tema="light"]) {\n${scuro}\n  }\n}`,
    );
  // La faccia scelta dalla pagina (lo script dell'SDK) vince su tutto.
  righe.push(`[data-tema="dark"] {\n${scuro}\n}`);
  // `color-scheme` fa scegliere al browser i colori suoi — barre di
  // scorrimento, caselle, menu a tendina — coerenti con la pagina.
  righe.push(
    tema === "dark"
      ? "html { color-scheme: dark; }"
      : tema === "light" || tema === "company"
        ? "html { color-scheme: light; }"
        : "html { color-scheme: light dark; }",
    'html[data-tema="dark"] { color-scheme: dark; }',
    'html[data-tema="light"] { color-scheme: light; }',
  );
  return `${righe.join("\n\n")}\n`;
}

export function themeRoutes(app: FastifyInstance): void {
  /**
   * **Aperta**, e la sessione se la legge da sé: sono colori, e una pagina di
   * plugin li carica anche dove la guardia non entra (la pagina di consenso
   * OAuth del connettore MCP, che è pubblica per contratto). Con una sessione
   * risponde con il tema di quella persona, senza con quello automatico —
   * che è come si comportavano le pagine dei plugin prima di oggi.
   */
  app.get("/api/tema.css", { config: { public: true } }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const utente = token ? await findSessionUser(token) : null;
    const tema = utente?.theme ?? "auto";
    const aziendale =
      tema === "company"
        ? ((await prisma.appSetting.findUnique({ where: { key: "branding.companyTheme" } }))
            ?.value ?? "jugaad")
        : "";
    return (
      reply
        .type("text/css; charset=utf-8")
        // Privato e da rivalidare: il tema è una scelta della persona e può
        // cambiare mentre l'applicazione è aperta.
        .header("cache-control", "private, no-cache")
        .send(temaCss(tema, aziendale))
    );
  });
}
