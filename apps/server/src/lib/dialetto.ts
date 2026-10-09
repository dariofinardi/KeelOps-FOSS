import { databasePath, motore } from "../db";

/**
 * **L'angolo del dialetto**: le poche espressioni SQL che i due motori scrivono
 * in modo diverso, in un punto solo.
 *
 * Il codice del prodotto parla Prisma e non SQL — per questo un cambio di
 * motore è possibile senza riscriverlo. Restano **tre** letture che Prisma non
 * sa esprimere e che vivono di SQL: l'ultima attività per progetto (tre tabelle
 * unite per data), la versione del motore, e la caccia ai file orfani, che legge
 * lo schema stesso del database. Quelle passano da qui.
 *
 * È lo stesso disegno che l'SDK dei plugin ha già (`db.sql.*`): tenere piccolo
 * questo angolo è ciò che rende il resto portabile.
 */

/** Un nome di tabella o colonna, citato come vuole il motore. */
export function ident(nome: string): string {
  return motore === "mariadb" ? `\`${nome.replace(/`/g, "``")}\`` : `"${nome.replace(/"/g, '""')}"`;
}

/** L'istante di N giorni fa, confrontabile con le date memorizzate. */
export function giorniFa(giorni: number): string {
  const n = Math.trunc(giorni);
  if (!Number.isFinite(n) || n < 0) throw new Error("giorniFa vuole un numero di giorni positivo");
  return motore === "mariadb"
    ? `DATE_SUB(NOW(), INTERVAL ${n} DAY)`
    : `datetime('now', '-${n} day')`;
}

/** Come si chiede al motore la propria versione, e come si chiama nell'elenco. */
export function versioneMotore(): { sql: string; etichetta: string } {
  return motore === "mariadb"
    ? { sql: "SELECT VERSION() AS version", etichetta: "MariaDB" }
    : { sql: "SELECT sqlite_version() AS version", etichetta: "SQLite" };
}

/**
 * Le colonne di testo di tutto il database, lette dallo schema: servono a
 * capire se un file è citato da qualche parte prima di cancellarlo. SQLite le
 * tiene in `sqlite_master` + `pragma table_info`, MySQL in `information_schema`
 * — che risponde in una query sola.
 */
export function colonneTestualiSql(): string | null {
  return motore === "mariadb"
    ? `SELECT TABLE_NAME AS tabella, COLUMN_NAME AS colonna
       FROM information_schema.columns
       WHERE TABLE_SCHEMA = DATABASE()
         AND DATA_TYPE IN ('varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext')
         AND TABLE_NAME NOT LIKE '\\_prisma%'`
    : null; // su SQLite si passa dai PRAGMA, tabella per tabella
}

/**
 * **Dove vivono i dati**, detto in modo leggibile in una pagina: il percorso del
 * file su SQLite, host, porta e nome del database su MariaDB.
 *
 * Senza credenziali, mai: questa riga finisce sotto gli occhi di chi guarda la
 * pagina Sistema, e utente e password non c'entrano niente con la domanda
 * «dove sono i miei dati».
 */
export function doveViveIlDatabase(): string {
  if (motore !== "mariadb") return databasePath;
  const host = process.env.MARIA_DB_HOST ?? "127.0.0.1";
  const porta = process.env.MARIA_DB_PORT ?? "3306";
  const nome = (process.env.MARIA_DB_NAME ?? "").replace(/['"]/g, "");
  return `${host}:${porta}/${nome}`;
}

/**
 * Quanto occupa il database. Su SQLite è la dimensione del file e la dice il
 * sistema operativo; su MariaDB quel file non esiste — `stat` restituiva zero e
 * la pagina Sistema mostrava «0 B», che sembra un guasto — quindi lo si chiede
 * al motore, che somma dati e indici di ogni tabella.
 */
export function dimensioneDatabaseSql(): string | null {
  return motore === "mariadb"
    ? `SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes
       FROM information_schema.tables WHERE table_schema = DATABASE()`
    : null;
}
