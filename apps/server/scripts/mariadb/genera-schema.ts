/**
 * **Lo schema per MariaDB si genera, non si copia.**
 *
 *   pnpm --filter @kancrm/server exec tsx scripts/mariadb/genera-schema.ts
 *
 * Finché la produzione gira su SQLite servono due schemi insieme, e due file
 * scritti a mano divergono al primo campo aggiunto — è successo troppe volte a
 * regole scritte due volte per non aspettarselo. Qui la fonte di verità resta
 * `prisma/schema.prisma`: da lì si ricava `prisma/mariadb/schema.prisma`
 * cambiando **solo** ciò che il motore impone (datasource, cartella del client,
 * lunghezze dei testi). Il giorno dello switch si scambiano i due file e questo
 * script sparisce.
 *
 * Cosa cambia, e nient'altro:
 *  - `provider = "mysql"` e l'URL dalle variabili `MARIA_DB_*`;
 *  - il client generato in `src/generated/prisma-mariadb`, così i due
 *    convivono e lo script di migrazione può parlare con entrambi;
 *  - i tipi delle colonne di testo (vedi `tipi.ts`, misurati sui dati veri).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { OLTRE_IL_LIMITE, TIPI_MARIADB } from "./tipi";

const RADICE = path.resolve(import.meta.dirname, "../..");
const SORGENTE = path.join(RADICE, "prisma/schema.prisma");
const DESTINAZIONE = path.join(RADICE, "prisma/mariadb/schema.prisma");

const INTESTAZIONE = `// GENERATO DA scripts/mariadb/genera-schema.ts — non modificare a mano.
//
// La fonte di verità è prisma/schema.prisma (SQLite, la produzione di oggi):
// qui cambiano solo datasource, cartella del client e i tipi delle colonne di
// testo che su MySQL non stanno in un VARCHAR(191). Rigenerare con:
//
//   pnpm --filter @kancrm/server exec tsx scripts/mariadb/genera-schema.ts
`;

/** Il datasource e il generator, riscritti per MySQL. */
function intestazioneMysql(): string {
  return `${INTESTAZIONE}
generator client {
  provider     = "prisma-client"
  output       = "../../src/generated/prisma-mariadb"
  runtime      = "nodejs"
  moduleFormat = "esm"
  engineType   = "client"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL_MARIADB")
}
`;
}

/**
 * Il corpo dello schema: tutto ciò che viene dopo il datasource, con le
 * annotazioni di tipo aggiunte campo per campo.
 */
function corpo(sorgente: string): { testo: string; annotati: string[] } {
  const inizioModelli = sorgente.search(/^(model|enum) /m);
  if (inizioModelli < 0) throw new Error("Nessun modello nello schema di partenza");
  const righe = sorgente.slice(inizioModelli).split("\n");

  const annotati: string[] = [];
  let modello = "";
  const uscita = righe.map((riga) => {
    const apertura = /^model (\w+) \{/.exec(riga);
    if (apertura) {
      modello = apertura[1]!;
      return riga;
    }
    if (riga.startsWith("}")) {
      modello = "";
      return riga;
    }
    if (!modello) return riga;
    // Un campo: nome, tipo, e il resto della riga (attributi e commento).
    const campo = /^(\s+)(\w+)(\s+)(String\??)(\s|$)/.exec(riga);
    if (!campo) return riga;
    const chiave = `${modello}.${campo[2]!}`;
    const tipo = TIPI_MARIADB[chiave];
    if (!tipo) return riga;
    annotati.push(chiave);
    // L'annotazione va dopo il tipo, prima degli altri attributi: Prisma vuole
    // `String @db.Text @default(...)`, non il contrario.
    return riga.replace(
      /^(\s+\w+\s+String\??)(\s|$)/,
      (_intero, testa: string, coda: string) => `${testa} ${tipo}${coda === "" ? "" : coda}`,
    );
  });
  return { testo: uscita.join("\n"), annotati };
}

const sorgente = readFileSync(SORGENTE, "utf8");
const { testo, annotati } = corpo(sorgente);

// Rete di sicurezza: le colonne che in produzione superano già i 191 caratteri
// DEVONO essere state annotate. Una dimenticanza qui si pagherebbe con dati
// troncati in silenzio, che è il guasto peggiore.
const dimenticate = OLTRE_IL_LIMITE.filter((chiave) => !annotati.includes(chiave));
if (dimenticate.length > 0) {
  console.error(`✗ Campi oltre il limite senza tipo MariaDB: ${dimenticate.join(", ")}`);
  console.error("  Aggiungili a scripts/mariadb/tipi.ts prima di continuare.");
  process.exit(1);
}
// E viceversa: un tipo che non corrisponde a nessun campo è un refuso o un
// campo rinominato, e resterebbe lì a non fare niente.
const orfani = Object.keys(TIPI_MARIADB).filter((chiave) => !annotati.includes(chiave));
if (orfani.length > 0) {
  console.error(`✗ In tipi.ts ci sono campi che lo schema non ha: ${orfani.join(", ")}`);
  process.exit(1);
}

mkdirSync(path.dirname(DESTINAZIONE), { recursive: true });
writeFileSync(DESTINAZIONE, intestazioneMysql() + "\n" + testo);
console.log(
  `✓ ${path.relative(RADICE, DESTINAZIONE)} — ${annotati.length} campi con tipo esplicito`,
);
