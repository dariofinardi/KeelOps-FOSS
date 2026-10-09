/**
 * **Prepara MariaDB**: crea (o aggiorna) le tabelle applicando le migrazioni di
 * `prisma/mariadb`.
 *
 *   pnpm exec tsx --env-file=/percorso/.env scripts/mariadb/prepara-db.ts
 *
 * Perché uno script e non `prisma migrate deploy` a mano: l'indirizzo di
 * connessione si compone dalle variabili `MARIA_DB_*`, e comporlo nella shell
 * vuol dire far passare la password dentro bash — che sui caratteri speciali
 * fa danni (il 01/09/2026 una `&` ha spezzato la riga e stampato mezza
 * password a schermo). Qui il file lo legge Node con `--env-file`, che non
 * interpreta niente, e la variabile arriva a Prisma solo nel suo ambiente.
 */
import { spawnSync } from "node:child_process";
import { urlLeggibile, urlMariaDb } from "./connessione";
import { RADICE, SCHEMA, scartoDalloSchema } from "./scarto";

const url = urlMariaDb();

console.log(`→ ${urlLeggibile()}`);
const esito = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy", `--schema=${SCHEMA}`], {
  cwd: RADICE,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL_MARIADB: url },
});
if (esito.status !== 0) process.exit(esito.status ?? 1);

/**
 * **Le migrazioni applicate non bastano: bisogna guardare il risultato.**
 *
 * Le migrazioni di MariaDB si ricavano da quelle di SQLite, e per un po' non si
 * sono ricavate affatto: la cartella aveva la sola `0_init`, quindi
 * `migrate deploy` diceva «niente da applicare» qualunque cosa fosse cambiata
 * nello schema, e la colonna nuova non veniva creata. Il guasto si sarebbe
 * visto a runtime, su una query, giorni dopo (02/09/2026).
 *
 * Perciò alla fine si richiede al motore se il database somiglia allo schema.
 * Se non somiglia ci si ferma **prima** che l'applicazione riparta, e si dice
 * esattamente cosa manca.
 */
const scarto = scartoDalloSchema();
if (scarto) {
  console.error(
    "\n✗ Le migrazioni sono passate, ma il database NON corrisponde allo schema.\n" +
      "  Manca questo:\n" +
      scarto
        .split("\n")
        .map((r) => `    ${r}`)
        .join("\n") +
      "\n\n  Genera la migrazione che manca e riprova:\n" +
      "    pnpm exec tsx scripts/mariadb/genera-migrazione.ts --nome <cosa-cambia>\n",
  );
  process.exit(1);
}
console.log("✓ Il database corrisponde allo schema.");
