/**
 * L'indirizzo di MariaDB, composto dalle variabili che stanno nel `.env`
 * dell'installazione: `MARIA_DB_USER`, `MARIA_DB_PASS`, `MARIA_DB_NAME`, e
 * facoltative `MARIA_DB_HOST` (default `127.0.0.1`) e `MARIA_DB_PORT` (3306).
 *
 * Si compone qui e non si scrive a mano da nessuna parte: una stringa di
 * connessione copiata in due file è una password copiata in due file. La
 * password viene **codificata**: una `@` o una `/` dentro romperebbero l'URL, e
 * l'errore che si legge («host sconosciuto») non ha niente a che vedere con la
 * causa.
 *
 * Le variabili si passano al comando senza esportarle a mano:
 *
 *   pnpm exec tsx --env-file=/percorso/.env scripts/mariadb/<script>.ts
 */
export function urlMariaDb(database?: string): string {
  const utente = process.env.MARIA_DB_USER;
  const password = process.env.MARIA_DB_PASS;
  // Un nome diverso serve a una cosa sola: il database d'appoggio con cui
  // Prisma calcola le migrazioni, che non dev'essere quello in esercizio.
  const nome = database ?? process.env.MARIA_DB_NAME;
  const host = process.env.MARIA_DB_HOST ?? "127.0.0.1";
  const porta = process.env.MARIA_DB_PORT ?? "3306";
  const mancanti = [
    ["MARIA_DB_USER", utente],
    ["MARIA_DB_PASS", password],
    ["MARIA_DB_NAME", nome],
  ]
    .filter(([, valore]) => !valore)
    .map(([nome]) => nome);
  if (mancanti.length > 0) {
    throw new Error(
      `Mancano le variabili ${mancanti.join(", ")}. Passa il file che le contiene:\n` +
        "  pnpm exec tsx --env-file=/percorso/.env scripts/mariadb/<script>.ts",
    );
  }
  return `mysql://${encodeURIComponent(utente!)}:${encodeURIComponent(password!)}@${host}:${porta}/${nome}`;
}

/**
 * Gli stessi dati come configurazione del pool, che è ciò che vuole
 * `@prisma/adapter-mariadb`. Preferita all'URL dove si può: niente password da
 * codificare, niente stringa da spezzare se contiene una `&` o una `/`.
 */
export function configMariaDb(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
} {
  urlMariaDb(); // riusa il controllo delle variabili e il suo messaggio
  return {
    host: process.env.MARIA_DB_HOST ?? "127.0.0.1",
    port: Number(process.env.MARIA_DB_PORT ?? 3306),
    user: process.env.MARIA_DB_USER!,
    password: process.env.MARIA_DB_PASS!,
    database: process.env.MARIA_DB_NAME!,
    // Una connessione sola: `SET FOREIGN_KEY_CHECKS` vale per sessione, e con
    // un pool gli inserimenti finirebbero su connessioni dove i controlli sono
    // ancora accesi.
    connectionLimit: 1,
  };
}

/** L'indirizzo senza la password, per i messaggi a schermo e i log. */
export function urlLeggibile(): string {
  const host = process.env.MARIA_DB_HOST ?? "127.0.0.1";
  const porta = process.env.MARIA_DB_PORT ?? "3306";
  return `mysql://${process.env.MARIA_DB_USER}:•••@${host}:${porta}/${process.env.MARIA_DB_NAME}`;
}
