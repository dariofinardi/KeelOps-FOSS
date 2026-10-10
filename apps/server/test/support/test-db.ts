// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Database usa e getta di un file di test: cartella temporanea, variabili
 * d'ambiente e le stesse migrazioni della produzione.
 *
 * Era copiato in ogni file (27 volte, con quattro varianti cosmetiche): il
 * setup dei test è codice come l'altro, e vive in un punto solo.
 *
 * ATTENZIONE all'ordine: va chiamato PRIMA di importare `../src/app` o
 * `../src/db`, che leggono `DATABASE_PATH` al primo import. È il motivo per cui
 * i file di test importano l'app con `await import(...)` dopo questa chiamata,
 * non con un import statico in testa.
 */
export function prepareTestDb(prefix: string): { tempDir: string; dbPath: string } {
  const tempDir = mkdtempSync(path.join(tmpdir(), `kancrm-test-${prefix}-`));
  const dbPath = path.join(tempDir, "test.db");
  process.env.DATABASE_PATH = dbPath;
  process.env.UPLOADS_DIR = path.join(tempDir, "uploads");

  const migrationsDir = path.resolve(import.meta.dirname, "../../prisma/migrations");
  const db = new Database(dbPath);
  for (const folder of readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const sqlFile = path.join(migrationsDir, folder, "migration.sql");
    try {
      db.exec(readFileSync(sqlFile, "utf8"));
    } catch (error) {
      // Una cartella di migrazione senza .sql (es. solo marker) non è un errore.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  db.close();
  return { tempDir, dbPath };
}
