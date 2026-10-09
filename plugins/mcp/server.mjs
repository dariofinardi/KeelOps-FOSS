/**
 * The STANDALONE mode of the MCP plugin: useful in development and in the
 * self-tests. In production the plugin is side-loaded into the core (see
 * plugin.mjs): same dispatcher, same routes, but the core's authentication
 * and lifecycle.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../keelops-sdk/database.mjs";
import { startServer } from "../keelops-sdk/http.mjs";
import { sessionUser } from "../keelops-sdk/session.mjs";
import { OAuthStore } from "./lib/oauth.mjs";
import { buildRoutes } from "./lib/routes.mjs";
import { manifest } from "./plugin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
if (existsSync(join(HERE, ".env")))
  for (const line of readFileSync(join(HERE, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2];
  }

const port = Number(env.PORT ?? 5320);
const db = openDatabase(env.KEELOPS_DB);
const cookie = env.SESSION_COOKIE ?? "kancrm_session";

startServer({
  port,
  name: "mcp",
  staticDir: join(HERE, "ui"),
  routes: buildRoutes({
    db,
    dataDir: join(HERE, "data"),
    store: new OAuthStore(join(HERE, "data", "oauth.json")),
    uiDir: join(HERE, "ui"),
    version: manifest.versione,
    keelopsUrl: (env.KEELOPS_URL ?? "").replace(/\/$/, ""),
    publicUrl: (env.MCP_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, ""),
    sessionUser: (req) => sessionUser(req, db, cookie),
  }),
});
