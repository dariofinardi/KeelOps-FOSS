// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Rimette un dump MariaDB al posto del database di un'istanza** (02/10/2026):
 * è il ripristino che `undeploy.sh` non sapeva fare — conosceva solo il file
 * SQLite, e dal 02/09/2026 i backup `--safe` contengono un `app.sql`.
 *
 *   pnpm exec tsx --env-file=<istanza>/.env scripts/mariadb/ripristina-dump.ts \
 *     <backup>/db/app.sql --database <nome del database>
 *
 * **Distruttivo**: prima toglie TUTTE le tabelle del database, poi rilegge il
 * dump. Toglierle serve a un ripristino esatto: una tabella creata da una
 * migrazione più recente resterebbe lì, il registro delle migrazioni tornato
 * indietro non la conoscerebbe, e al deploy successivo la migrazione fallirebbe
 * con «tabella già esistente».
 *
 * Il nome del database va scritto due volte — in `--database` e nel `.env`
 * (`MARIA_DB_NAME`) — e se non coincidono lo script si ferma: sovrascrivere il
 * database sbagliato è l'errore che non si recupera.
 *
 * Si lancia a servizio fermo (lo fa `undeploy.sh`).
 */
import { existsSync, statSync } from "node:fs";
import mariadb from "mariadb";
import { ripristinaDumpMariaDb } from "../../src/modules/admin/dump-db";
import { configMariaDb } from "./connessione";

const [file] = process.argv
  .slice(2)
  .filter((a, i, tutti) => !a.startsWith("--") && tutti[i - 1] !== "--database");
const flag = process.argv.indexOf("--database");
const indicato = flag === -1 ? undefined : process.argv[flag + 1];

function ferma(messaggio: string): never {
  console.error(`✗ ${messaggio}`);
  process.exit(2);
}

if (!file) ferma("Uso: ripristina-dump.ts <file.sql> --database <nome>");
if (!existsSync(file) || statSync(file).size === 0) ferma(`Dump non trovato o vuoto: ${file}`);
if (!indicato) ferma("Manca --database <nome>: va scritto il database che si sovrascrive");
const config = configMariaDb();
if (indicato !== config.database) {
  ferma(
    `--database ${indicato} ma il .env dice MARIA_DB_NAME=${config.database}: non tocco niente`,
  );
}

const connessione = await mariadb.createConnection({ ...config, multipleStatements: false });
try {
  const tabelle = (await connessione.query(
    "SELECT TABLE_NAME AS nome FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
    [config.database],
  )) as Array<{ nome: string }>;
  console.log(`→ ${config.database}: tolgo ${tabelle.length} tabelle`);
  await connessione.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { nome } of tabelle) {
    await connessione.query(`DROP TABLE IF EXISTS \`${nome.replace(/`/g, "``")}\``);
  }
  await connessione.query("SET FOREIGN_KEY_CHECKS = 1");
} finally {
  await connessione.end();
}

console.log(`→ rileggo ${file}`);
await ripristinaDumpMariaDb(file, config.database);
console.log(`✓ ${config.database} ripristinato da ${file}`);
