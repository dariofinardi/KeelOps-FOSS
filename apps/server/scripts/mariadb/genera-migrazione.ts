/**
 * **La migrazione MariaDB che corrisponde a quella SQLite appena scritta.**
 *
 *   pnpm exec tsx scripts/mariadb/genera-schema.ts
 *   pnpm exec tsx --env-file=<.env> scripts/mariadb/genera-migrazione.ts --nome aggiunge-campo-x
 *
 * Lo schema di MariaDB si ricava da `prisma/schema.prisma`, ma **una migrazione
 * non si ricava dallo schema**: serve sapere da dove si parte. Per settimane
 * qui non c'è stato niente, e la cartella ha avuto la sola `0_init`: risultato,
 * `migrate deploy` non aveva mai niente da applicare e ogni campo aggiunto
 * restava fuori dal database, in silenzio, fino alla prima query che lo cercava
 * (02/09/2026).
 *
 * Il «da dove si parte» è il database **in esercizio**, che è la verità e non
 * una ricostruzione. Perciò va lanciato con il `.env` dell'installazione che si
 * sta per aggiornare, e la migrazione che ne esce **va committata** come tutte
 * le altre: chi farà il deploy applicherà quella, non ne ricalcolerà un'altra.
 *
 * `--anteprima` mostra l'SQL senza scrivere niente.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { urlLeggibile } from "./connessione";
import { RADICE, scartoDalloSchema } from "./scarto";

const args = process.argv.slice(2);
const opzione = (nome: string): string | null => {
  const i = args.indexOf(nome);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};

const nome = (opzione("--nome") ?? "").trim();
if (!nome && !args.includes("--anteprima")) {
  console.error(
    "uso: genera-migrazione.ts --nome <cosa-cambia> [--anteprima]\n" +
      "  il nome finisce nella cartella della migrazione: scrivilo come lo leggeresti fra un anno",
  );
  process.exit(2);
}
if (nome && !/^[a-z0-9][a-z0-9-]*$/.test(nome)) {
  console.error("✗ Il nome vuole minuscole, cifre e trattini: diventa un nome di cartella.");
  process.exit(2);
}

console.log(`→ ${urlLeggibile()}`);
const sql = scartoDalloSchema();

if (!sql) {
  console.log("✓ Il database corrisponde già allo schema: non c'è niente da migrare.");
  process.exit(0);
}

if (args.includes("--anteprima")) {
  console.log(`\n${sql}\n`);
  console.log("(--anteprima: non ho scritto niente)");
  process.exit(0);
}

const stampo = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const cartella = path.join(RADICE, "prisma/mariadb/migrations", `${stampo}_${nome}`);
mkdirSync(cartella, { recursive: true });
const file = path.join(cartella, "migration.sql");
writeFileSync(file, `${sql}\n`);

console.log(`\n${sql}\n`);
console.log(`✓ Scritta: ${path.relative(RADICE, file)}`);
console.log("  Committala, poi applicala con  scripts/mariadb/prepara-db.ts  (lo fa il deploy).");
