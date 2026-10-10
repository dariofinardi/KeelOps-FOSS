// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

// Prepara il database E2E (migrazioni + seed) PRIMA di avviare il server.
// Eseguito dal comando webServer di Playwright (vedi playwright.config.ts).
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, "e2e", ".data");
const dbPath = path.join(dataDir, "app.db");

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

// better-sqlite3 risolto dal package del server (non è una dipendenza root).
const serverRequire = createRequire(path.join(root, "apps", "server", "package.json"));
const Database = serverRequire("better-sqlite3");

const migrationsDir = path.join(root, "apps", "server", "prisma", "migrations");
const db = new Database(dbPath);
// Solo le cartelle: accanto alle migrazioni c'è migration_lock.toml, che è un
// file (aprirlo come cartella darebbe ENOTDIR, non ENOENT).
for (const entry of readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  db.exec(readFileSync(path.join(migrationsDir, entry, "migration.sql"), "utf8"));
}
db.close();

execSync("pnpm --filter @kancrm/server exec tsx prisma/seed.ts", {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, DATABASE_PATH: dbPath },
});

console.log("E2E db pronto:", dbPath);
