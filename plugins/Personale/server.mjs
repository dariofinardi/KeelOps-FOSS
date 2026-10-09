/**
 * The STANDALONE mode of the Personale plugin: development and the self-test.
 * In production the plugin is side-loaded into the core (plugin.mjs): same
 * dispatcher, same routes, the core's authentication, database and lifecycle.
 *
 * Unlike the read-only plugins this one WRITES, so it takes the SDK's
 * writable SQLite driver — the borrowed driver, the same code path the core
 * uses, over a `node:sqlite` handle with the prefix gate in place: even here
 * the plugin cannot touch `Task`. Run it against a COPY of the database,
 * never the real one.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openWritableSqlite, prepareOwnedTables } from "../keelops-sdk/database.mjs";
import { startServer } from "../keelops-sdk/http.mjs";
import { sessionUser } from "../keelops-sdk/session.mjs";
import { buildRoutes } from "./lib/routes.mjs";
import { migrate, NICK, SCHEMA_VERSION } from "./lib/schema.mjs";
import { manifest } from "./plugin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
if (existsSync(join(HERE, ".env")))
  for (const line of readFileSync(join(HERE, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2];
  }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = openWritableSqlite(env.KEELOPS_DB, NICK);
  await prepareOwnedTables(db, { nick: NICK, schemaVersion: SCHEMA_VERSION, migrate, version: manifest.versione });
  const cookie = env.SESSION_COOKIE ?? "kancrm_session";
  startServer({
    port: Number(env.PORT ?? 5320),
    name: "Personale",
    staticDir: join(HERE, "ui", "dist"),
    routes: buildRoutes({
      db,
      keelopsUrl: (env.KEELOPS_URL ?? "").replace(/\/$/, ""),
      version: manifest.versione,
      sessionUser: (req) => sessionUser(req, db, cookie),
    }),
  });
}
