// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { InfoDatabase } from "./db-info";

/**
 * Versioni di quello che sta effettivamente girando: non i vincoli scritti nei
 * `package.json` ("^5.10.0") ma il numero del pacchetto installato, che è la cosa
 * che serve sapere quando si deve capire perché in produzione succede qualcosa
 * che in sviluppo non succede.
 *
 * Sono le sole librerie del server: quelle del frontend le dichiara la build
 * (vedi `apps/web/vite.config.ts`), perché è lì che finiscono dentro al bundle.
 */

const require = createRequire(import.meta.url);

/**
 * Le librerie da mostrare **si leggono dal `package.json`**, non da un elenco
 * scritto a mano: quello si dimentica — era fermo a sei nomi su diciannove — e
 * la pagina Sistema serve proprio a dire cosa gira davvero. Chi aggiunge una
 * dipendenza non deve ricordarsi di aggiornare anche questo file.
 *
 * Restano fuori i pacchetti del monorepo (`@kancrm/*`): la loro versione è
 * quella dell'applicazione, già scritta sopra.
 */
function declaredDependencies(): string[] {
  try {
    const pkgPath = path.resolve(import.meta.dirname, "../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies ?? {})
      .filter((name) => !name.startsWith("@kancrm/"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function packageVersion(name: string): string | null {
  try {
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    // Alcuni pacchetti non elencano il proprio package.json fra gli "exports"
    // (node-cron): si risale dal file principale fino alla cartella del pacchetto.
    try {
      let dir = path.dirname(require.resolve(name));
      for (let depth = 0; depth < 6; depth++) {
        const candidate = path.join(dir, "package.json");
        if (existsSync(candidate)) {
          const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
            name?: string;
            version?: string;
          };
          if (pkg.name === name && pkg.version) return pkg.version;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // Un pacchetto che non si risolve non è un errore da mostrare all'admin.
    }
    return null;
  }
}

export interface VersionEntry {
  name: string;
  version: string;
}

/** Node, il motore della banca dati e le librerie del server, saltando quelle che non si risolvono. */
export function serverVersions(database: InfoDatabase): VersionEntry[] {
  // Il motore lo sa già chi ha interrogato il database: chiederglielo di nuovo
  // qui sarebbe la stessa domanda fatta due volte nella stessa risposta.
  const entries: VersionEntry[] = [
    { name: "Node.js", version: process.version.replace(/^v/, "") },
    ...(database.versione ? [{ name: database.etichetta, version: database.versione }] : []),
  ];
  for (const name of declaredDependencies()) {
    const version = packageVersion(name);
    if (version) entries.push({ name, version });
  }
  return entries;
}
