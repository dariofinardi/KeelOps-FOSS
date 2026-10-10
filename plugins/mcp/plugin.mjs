// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The side-loaded entry point of the MCP plugin: the core (plugin-host) calls
 * `create(ctx)` and gets the routes; authentication and database come from
 * the core. `wellKnown` declares the OAuth documents the core must also
 * expose in the RFC 8414 path-insertion form
 * (`/.well-known/<doc>/plugins/mcp`), the one clients look for when the
 * issuer has a path component.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OAuthStore } from "./lib/oauth.mjs";
import { buildRoutes } from "./lib/routes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const manifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));

export function create(ctx) {
  return {
    routes: buildRoutes({
      ...ctx,
      store: new OAuthStore(join(ctx.dataDir, "oauth.json")),
      uiDir: join(HERE, "ui"),
      version: manifest.versione,
    }),
    staticDir: join(HERE, "ui"),
    wellKnown: ["oauth-authorization-server", "oauth-protected-resource", "openid-configuration"],
  };
}
