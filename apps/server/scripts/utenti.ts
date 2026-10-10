// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Utenti da riga di comando — per chi amministra il server.
 *
 *   pnpm --filter @kancrm/server exec tsx scripts/utenti.ts elenco
 *   pnpm --filter @kancrm/server exec tsx scripts/utenti.ts reset <email>
 *   pnpm --filter @kancrm/server exec tsx scripts/utenti.ts reset <email> --password "Altra1!"
 *   pnpm --filter @kancrm/server exec tsx scripts/utenti.ts crea-admin <email> --nome "Nome Cognome"
 *
 * In produzione va indicato il database (e il pepe, se configurato):
 *
 *   DATABASE_PATH=/srv/keelops/data/app.db \
 *   PASSWORD_PEPPER_FILE=/srv/keelops/config.json \
 *   pnpm --filter @kancrm/server exec tsx scripts/utenti.ts elenco
 *
 * Il reset scrive: chiude anche le sessioni aperte dell'utente.
 */
import { config } from "../src/config";
import { databasePath, motore, prisma } from "../src/db";
import {
  DEFAULT_RESET_PASSWORD,
  createAdmin,
  listUsers,
  resetUserPassword,
} from "../src/modules/users/admin-cli";

const USAGE = `Uso:
  utenti.ts elenco                      elenco utenti con l'ultimo accesso
  utenti.ts reset <email> [--password X]  reimposta la password (default ${DEFAULT_RESET_PASSWORD})
  utenti.ts crea-admin <email> [--nome "Nome Cognome"]  il primo amministratore di un'istanza nuova`;

function formatDate(date: Date | null): string {
  if (!date) return "mai";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: config.displayTimezone,
  }).format(date);
}

async function elenco(): Promise<void> {
  const users = await listUsers();
  const larghezza = Math.max(...users.map((user) => user.email.length), 20);
  console.log(
    `${"UTENTE".padEnd(24)} ${"EMAIL".padEnd(larghezza)} ${"RUOLO".padEnd(14)} ` +
      `${"ULTIMO ACCESSO".padEnd(17)} ${"ULTIMA ATTIVITÀ".padEnd(17)} STATO`,
  );
  for (const user of users) {
    console.log(
      `${user.name.slice(0, 23).padEnd(24)} ${user.email.padEnd(larghezza)} ` +
        `${user.role.padEnd(14)} ${formatDate(user.lastLoginAt).padEnd(17)} ` +
        `${formatDate(user.lastSeenAt).padEnd(17)} ${user.isActive ? "attivo" : "disattivato"}`,
    );
  }
  console.log(`\n${users.length} utenti (l'utente di sistema non si conta).`);
}

async function reset(email: string, password: string): Promise<void> {
  const esito = await resetUserPassword(email, password);
  console.log(`Password reimpostata per ${esito.name} <${esito.email}>.`);
  console.log(`Nuova password: ${esito.password}`);
  if (esito.closedSessions > 0) {
    console.log(`Sessioni chiuse: ${esito.closedSessions} — dovrà rientrare.`);
  }
  console.log("Comunicagliela a voce: al primo accesso gli verrà chiesto di sceglierne una sua.");
}

async function main(): Promise<void> {
  const [comando, ...resto] = process.argv.slice(2);
  // Il pepe si dichiara: se manca mentre il database lo usa, l'hash scritto qui
  // non funzionerebbe — meglio accorgersene ora che al prossimo accesso.
  // Su MariaDB un percorso di file non vuol dire niente: si dice dove si sta
  // scrivendo davvero, che è la prima cosa da sapere prima di toccare una password.
  const dove =
    motore === "mariadb"
      ? `MariaDB ${process.env.MARIA_DB_NAME ?? "?"} su ${process.env.MARIA_DB_HOST ?? "127.0.0.1"}`
      : databasePath;
  console.log(`Database: ${dove} · pepe: ${config.passwordPepperFile || "nessuno"}\n`);

  if (comando === "elenco") return elenco();
  if (comando === "reset") {
    const email = resto[0];
    if (!email) throw new Error(`Manca l'indirizzo email.\n${USAGE}`);
    const flag = resto.indexOf("--password");
    const password = flag === -1 ? DEFAULT_RESET_PASSWORD : resto[flag + 1];
    if (!password) throw new Error("--password richiede un valore");
    return reset(email, password);
  }
  if (comando === "crea-admin") {
    const email = resto[0];
    if (!email) throw new Error(`Manca l'indirizzo email.\n${USAGE}`);
    const flag = resto.indexOf("--nome");
    const nome = flag === -1 ? email : (resto[flag + 1] ?? email);
    const esito = await createAdmin(email, nome);
    console.log(`Amministratore creato: ${esito.name} <${esito.email}>.`);
    console.log(`Password provvisoria: ${esito.password}`);
    console.log("Comunicagliela a voce: al primo accesso gli verrà chiesto di sceglierne una sua.");
    return;
  }
  throw new Error(USAGE);
}

void main()
  .catch((error) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
