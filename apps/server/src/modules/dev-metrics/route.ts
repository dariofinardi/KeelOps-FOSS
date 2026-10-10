// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyInstance } from "fastify";
import { forbidden } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { canSeeDevMetrics, devMetrics } from "./service";

export function devMetricsRoutes(app: FastifyInstance): void {
  /**
   * L'andamento dell'area tecnica: il secondo pannello di "La mia giornata".
   * Il permesso lo decide `canSeeDevMetrics` — chi lavora nell'area o chi la
   * governa — e il DTO utente porta lo stesso flag, così il selettore in
   * pagina non offre una vista che risponderebbe 403. Stava fra le rotte della
   * dashboard; dall'08/10/2026 ha un modulo suo, nel nucleo: è la vista del
   * manager dello sviluppo in tutte e due le edizioni.
   */
  app.get("/api/dashboard/dev-metrics", async (request) => {
    const user = requireUser(request);
    if (!(await canSeeDevMetrics(user))) {
      throw forbidden("L'andamento è riservato a chi lavora nell'area tecnica");
    }
    return devMetrics(user, new Date());
  });
}
