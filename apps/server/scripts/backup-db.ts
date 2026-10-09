/**
 * Il backup del database, da riga di comando — per `deploy.sh` e per chiunque
 * ne voglia uno prima di toccare qualcosa.
 *
 *   DATABASE_PATH=… pnpm exec tsx scripts/backup-db.ts <cartella> [nome]
 *   pnpm exec tsx --env-file=<.env> scripts/backup-db.ts <cartella> [nome]
 *
 * Non sa come si fa: lo chiede a `modules/admin/dump-db`, che è lo stesso punto
 * da cui passano l'istantanea notturna e lo zip della pagina Sistema. Stampa il
 * file prodotto, così chi lo lancia sa cosa ha in mano — su MariaDB è un `.sql`,
 * su SQLite un `.db`, e chiamarli allo stesso modo sarebbe il modo più rapido
 * di rendere inservibile un archivio.
 */
import { statSync } from "node:fs";
import { dumpDatabase } from "../src/modules/admin/dump-db";
import { motore } from "../src/db";

const cartella = process.argv[2];
if (!cartella) {
  console.error("uso: backup-db.ts <cartella> [nome]");
  process.exit(2);
}
const esito = await dumpDatabase(cartella, process.argv[3] ?? "app");
const mb = (statSync(esito.file).size / 1024 / 1024).toFixed(1);
console.log(`${esito.file}  (${mb} MB, motore ${motore})`);
