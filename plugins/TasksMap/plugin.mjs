/**
 * The side-loaded entry point: the core (plugin-host) calls `create(ctx)` and
 * gets routes, a static folder and the migration; authentication and database
 * come from the core. This plugin OWNS one table (`plugin_tasksmap_vettore`,
 * lib/schema.mjs): the core checks the two versions in
 * `plugin_tasksmap_config` before mounting it. Security lives in the code —
 * the routes apply the user's visibility perimeter — not in tokens or
 * separate processes.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRoutes } from "./lib/routes.mjs";
import { migrate } from "./lib/schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const manifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));

/** Until 0.1.x the graphs sat in files under the data dir: gone, they are in the table now. */
function dropOldFileCache(dataDir) {
  try {
    for (const f of readdirSync(dataDir)) if (/^grafo-.*\.json$/.test(f)) rmSync(join(dataDir, f), { force: true });
  } catch { /* no data dir, nothing to drop */ }
}

export function create(ctx) {
  if (ctx.dataDir) dropOldFileCache(ctx.dataDir);
  return {
    routes: buildRoutes({ ...ctx, version: manifest.versione }),
    staticDir: join(HERE, "ui"),
    wellKnown: [],
    migrate,
  };
}
