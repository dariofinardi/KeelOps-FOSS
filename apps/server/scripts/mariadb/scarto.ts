// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Quanto manca al database per assomigliare allo schema.** Una domanda sola,
 * chiesta a Prisma, che serve in due posti: prima di generare una migrazione
 * (per sapere cosa scriverci dentro) e dopo averle applicate (per accorgersi
 * che non è arrivato niente).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { urlMariaDb } from "./connessione";

export const RADICE = path.resolve(import.meta.dirname, "../..");
export const SCHEMA = path.join(RADICE, "prisma/mariadb/schema.prisma");

/** L'SQL che porterebbe il database allo schema; stringa vuota se combaciano. */
export function scartoDalloSchema(database?: string): string {
  const esito = spawnSync(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--from-url",
      urlMariaDb(database),
      "--to-schema-datamodel",
      SCHEMA,
      "--script",
    ],
    { cwd: RADICE, encoding: "utf8", env: { ...process.env } },
  );
  if (esito.status !== 0) {
    throw new Error(`prisma migrate diff non è riuscito:\n${esito.stderr || esito.stdout}`);
  }
  const testo = senzaDropDegliIndiciImpliciti(senzaTabelleDeiPlugin((esito.stdout ?? "").trim()));
  // Prisma dichiara «nessuna differenza» con un commento, non con il vuoto.
  return /^--\s*This is an empty migration\.?$/im.test(testo) ? "" : testo;
}

/**
 * **Le tabelle dei plugin non sono dello schema, e il differ non lo sa.** Un
 * plugin crea e mantiene da sé le sue `plugin_<nick>_*`; Prisma, confrontando
 * il database con `schema.prisma`, le vede come tabelle in più e scrive
 * `DROP TABLE` per ognuna — con le chiavi esterne davanti. La migrazione per
 * la chiave di unicità delle notifiche è uscita così, con sei DROP delle
 * tabelle di «Personale» in mezzo (05/09/2026): applicata, avrebbe cancellato
 * le bacheche di tutti. Qui si tolgono i blocchi che le nominano; se ne
 * resta solo il commento di Prisma, il risultato è «niente da migrare».
 */
export function senzaTabelleDeiPlugin(sql: string): string {
  const blocchi = sql.split(/\n\s*\n/);
  const tenuti = blocchi.filter((blocco) => !/`plugin_[a-z0-9]+_[a-z0-9_]+`/i.test(blocco));
  const testo = tenuti.join("\n\n").trim();
  return testo || "-- This is an empty migration.";
}

/**
 * **MariaDB toglie da sé l'indice implicito di una chiave esterna** appena ne
 * crea uno esplicito che la copre. Prisma non lo sa: per ogni indice nuovo su
 * una colonna con chiave esterna scrive un blocco «RedefineIndex» — `CREATE
 * INDEX x_idx` e poi `DROP INDEX x_fkey` — e il DROP fallisce con 1091 «check
 * that it exists», a migrazione mezza applicata e servizio fermo (05/09/2026,
 * rilascio 0.12.2). Qui il DROP degli indici `_fkey` si toglie; la CREATE resta.
 */
export function senzaDropDegliIndiciImpliciti(sql: string): string {
  const righe = sql
    .split("\n")
    .filter((riga) => !/^DROP INDEX `[^`]+_fkey` ON `[^`]+`;\s*$/.test(riga));
  return righe.join("\n").replace(/-- RedefineIndex\n/g, "-- CreateIndex\n");
}
