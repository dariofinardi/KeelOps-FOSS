// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { databasePath, motore } from "../../db";

/**
 * **Portare via il database, qualunque sia il motore.**
 *
 * Su SQLite un backup è la copia del file — fatta con l'API di backup, che dà
 * un'istantanea consistente mentre il servizio scrive. Su MariaDB il file non
 * esiste: il backup è un dump SQL, e va chiesto al motore.
 *
 * Le due cose vivono qui perché il backup lo fanno in tre: l'istantanea
 * notturna, lo zip della pagina Sistema e la copia che `deploy.sh` prende prima
 * di migrare. Se ognuno sapesse come si fa, il giorno del cambio motore due su
 * tre resterebbero indietro — e un backup che non c'è si scopre quando serve.
 *
 * **La password non passa mai dalla riga di comando** (`ps` la mostrerebbe a
 * chiunque): si scrive in un file di configurazione temporaneo con i permessi
 * stretti, che `mariadb-dump` legge e che spariscce subito dopo.
 */

export interface EsitoDump {
  /** Il file prodotto. */
  file: string;
  /** `db` per SQLite (copia binaria), `sql` per MariaDB (dump testuale). */
  formato: "db" | "sql";
}

/** L'estensione che avrà il backup con il motore di adesso. */
export function estensioneDump(): "db" | "sql" {
  return motore === "mariadb" ? "sql" : "db";
}

/**
 * Scrive il backup dentro `cartella` e restituisce il percorso. Il nome del
 * file lo decide il chiamante (`nome`), l'estensione la decide il motore: un
 * `.db` che dentro ha SQL, o viceversa, è il modo più rapido di rendere
 * inservibile un archivio.
 */
export async function dumpDatabase(cartella: string, nome = "app"): Promise<EsitoDump> {
  const formato = estensioneDump();
  const file = path.join(cartella, `${nome}.${formato}`);
  if (motore !== "mariadb") {
    const sorgente = new Database(databasePath, { readonly: true });
    try {
      await sorgente.backup(file);
    } finally {
      sorgente.close();
    }
    return { file, formato };
  }
  await dumpMariaDb(file);
  return { file, formato };
}

/** Il dump di MariaDB, con le credenziali dell'ambiente. */
async function dumpMariaDb(destinazione: string): Promise<void> {
  const configDir = await mkdtemp(path.join(tmpdir(), "keelops-dump-"));
  const configFile = path.join(configDir, "credenziali.cnf");
  try {
    // `[client]`: lo leggono sia mariadb-dump sia mariadb (il ripristino).
    await writeFile(
      configFile,
      `[client]\nhost=${process.env.MARIA_DB_HOST ?? "127.0.0.1"}\n` +
        `port=${process.env.MARIA_DB_PORT ?? 3306}\n` +
        `user=${process.env.MARIA_DB_USER ?? ""}\n` +
        `password="${(process.env.MARIA_DB_PASS ?? "").replace(/"/g, '\\"')}"\n`,
      { mode: 0o600 },
    );
    await chmod(configFile, 0o600);
    const uscita = createWriteStream(destinazione);
    await new Promise<void>((risolvi, rifiuta) => {
      const figlio = spawn(
        "mariadb-dump",
        [
          `--defaults-file=${configFile}`,
          // Istantanea consistente senza bloccare chi scrive (tabelle InnoDB).
          "--single-transaction",
          "--routines",
          "--events",
          "--triggers",
          // Senza, un ripristino su un server con impostazioni diverse può
          // cambiare gli orari di tutto ciò che è datato.
          "--tz-utc",
          "--default-character-set=utf8mb4",
          process.env.MARIA_DB_NAME ?? "",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let errori = "";
      figlio.stderr.on("data", (pezzo: Buffer) => (errori += pezzo.toString()));
      figlio.stdout.pipe(uscita);
      figlio.on("error", rifiuta);
      figlio.on("close", (codice) => {
        uscita.close();
        if (codice === 0) risolvi();
        else rifiuta(new Error(`mariadb-dump è uscito con ${codice}: ${errori.slice(0, 400)}`));
      });
    });
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

/**
 * Il verso opposto: rimette un backup dentro un database. Serve al ripristino
 * vero e alla **prova** del ripristino, che è l'unica cosa che dice davvero se
 * un backup vale qualcosa.
 *
 * Su SQLite non è codice: si copia il file al suo posto, a servizio fermo. Qui
 * si tratta solo il caso MariaDB, dove serve rileggere lo script.
 */
export async function ripristinaDumpMariaDb(file: string, database: string): Promise<void> {
  const configDir = await mkdtemp(path.join(tmpdir(), "keelops-restore-"));
  const configFile = path.join(configDir, "credenziali.cnf");
  try {
    await writeFile(
      configFile,
      `[client]\nhost=${process.env.MARIA_DB_HOST ?? "127.0.0.1"}\n` +
        `port=${process.env.MARIA_DB_PORT ?? 3306}\n` +
        `user=${process.env.MARIA_DB_USER ?? ""}\n` +
        `password="${(process.env.MARIA_DB_PASS ?? "").replace(/"/g, '\\"')}"\n`,
      { mode: 0o600 },
    );
    await chmod(configFile, 0o600);
    await new Promise<void>((risolvi, rifiuta) => {
      const figlio = spawn(
        "bash",
        ["-c", `mariadb --defaults-file='${configFile}' '${database}' < '${file}'`],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let errori = "";
      figlio.stderr.on("data", (pezzo: Buffer) => (errori += pezzo.toString()));
      figlio.on("error", rifiuta);
      figlio.on("close", (codice) =>
        codice === 0
          ? risolvi()
          : rifiuta(new Error(`ripristino fallito (${codice}): ${errori.slice(0, 400)}`)),
      );
    });
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}
