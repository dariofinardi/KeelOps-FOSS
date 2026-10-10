// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    /** Metodo e percorso di ogni rotta registrata, in ordine di registrazione. */
    rotteRegistrate: string[];
  }
}

/**
 * **L'elenco delle rotte registrate** (08/10/2026). Serve a una cosa sola:
 * dimostrare che dividere il codice in edizioni (community e commerciale) non
 * perde e non aggiunge una rotta. `test/edition-routes.test.ts` confronta
 * l'elenco con quello fotografato prima del lavoro.
 *
 * Va chiamato subito dopo `Fastify()`, prima di qualunque registrazione: l'hook
 * `onRoute` vede solo le rotte che arrivano dopo di lui.
 */
export function registraElencoRotte(app: FastifyInstance): void {
  const rotte: string[] = [];
  app.decorate("rotteRegistrate", rotte);
  app.addHook("onRoute", (rotta) => {
    for (const metodo of [rotta.method].flat()) rotte.push(`${metodo} ${rotta.url}`);
  });
}
