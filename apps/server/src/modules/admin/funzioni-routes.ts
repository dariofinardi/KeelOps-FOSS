// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyInstance } from "fastify";
import { setFunzioniSpenteInput } from "@kancrm/shared";
import { requireAdmin } from "../../plugins/auth";
import { impostaFunzioniSpente, statoFunzioni } from "../../edition/funzioni";

/**
 * **Le funzioni dell'istanza** dalla pagina Sistema (17/10/2026): leggerle e
 * cambiarle è da amministratore **elevato**, come il resto di `/api/admin`.
 * Vedi `plan/funzioni-istanza.md`.
 */
export function funzioniRoutes(app: FastifyInstance): void {
  app.get("/api/admin/funzioni", async (request) => {
    requireAdmin(request);
    return statoFunzioni();
  });

  app.put("/api/admin/funzioni", async (request) => {
    const user = requireAdmin(request);
    const { spente } = setFunzioniSpenteInput.parse(request.body);
    const stato = await impostaFunzioniSpente(spente);
    // Nel log di chi e quando: spegnere un'area la toglie a tutti.
    request.log.info({ utente: user.email, spente }, "Funzioni dell'istanza cambiate");
    return stato;
  });
}
