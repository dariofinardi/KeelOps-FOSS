// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The STANDALONE mode of the TasksMap plugin: useful in development and in the
 * self-tests. In production the plugin is side-loaded into the core (see
 * plugin.mjs): same dispatcher, same routes, but the core's authentication
 * and lifecycle. It writes its vectors, so it takes the SDK's writable SQLite
 * driver (prefix-gated, like the core's borrowed connection): run it against
 * a COPY of the database, never the real one.
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

const db = openWritableSqlite(env.KEELOPS_DB, NICK);
await prepareOwnedTables(db, { nick: NICK, schemaVersion: SCHEMA_VERSION, migrate, version: manifest.versione });
const cookie = env.SESSION_COOKIE ?? "kancrm_session";

startServer({
  port: Number(env.PORT ?? 5310),
  name: "TasksMap",
  staticDir: join(HERE, "ui"),
  routes: buildRoutes({
    db,
    keelopsUrl: (env.KEELOPS_URL ?? "").replace(/\/$/, ""),
    ollamaUrl: env.OLLAMA_URL || null,
    version: manifest.versione,
    sessionUser: (req) => sessionUser(req, db, cookie),
  }),
});
