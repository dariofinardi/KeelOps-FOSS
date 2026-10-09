/**
 * The side-loaded entry point: the core (plugin-host) calls `create(ctx)` and
 * gets routes, a static folder and the migration; authentication and database
 * come from the core. This plugin OWNS its tables (`plugin_personale_*`): it
 * creates and migrates them (lib/schema.mjs), and the core checks the two
 * versions in `plugin_personale_config` before mounting it.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRoutes } from "./lib/routes.mjs";
import { migrate } from "./lib/schema.mjs";
import { riepilogoMattutino } from "./lib/riepilogo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const manifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));

export function create(ctx) {
  return {
    routes: buildRoutes({ ...ctx, version: manifest.versione }),
    staticDir: join(HERE, "ui", "dist"),
    wellKnown: [],
    migrate,
    // the plugin's line in the 7:00 digest: who has personal cards due, and the sentence in their language
    riepilogoMattutino: (opzioni) => riepilogoMattutino(ctx.db, opzioni),
  };
}
