// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyInstance } from "fastify";
import { setMaintenanceInput } from "@kancrm/shared";
import { requireAdmin } from "../../plugins/auth";
import { maintenanceState, setMaintenance } from "./service";

export function maintenanceRoutes(app: FastifyInstance): void {
  /**
   * Pubblica per necessità: la interroga la pagina di cortesia per accorgersi
   * del ritorno online, quando una sessione può non esserci affatto. Non dice
   * nulla che la pagina stessa non mostri già.
   */
  app.get("/api/maintenance", { config: { public: true } }, async () => maintenanceState());

  /**
   * Lo script di riprova della pagina di cortesia, come FILE e non inline: la
   * CSP del core ammette solo script della stessa origine, e la pagina deve
   * rispettarla come chiunque. Vive sotto /api/maintenance così il cancello
   * lo lascia passare anche a manutenzione accesa.
   */
  app.get("/api/maintenance/retry.js", { config: { public: true } }, async (request, reply) => {
    return reply.type("text/javascript; charset=utf-8").send(`(function retry(){
  setTimeout(async () => {
    try {
      const r = await fetch("/api/maintenance", { cache: "no-store" });
      const s = await r.json();
      if (!s.active) { location.reload(); return; }
    } catch { /* server giu (riavvio): si continua a riprovare */ }
    retry();
  }, 10000);
})();
`);
  });

  /** Accendere/spegnere è roba da amministratore ELEVATO, come il resto di /api/admin. */
  app.post("/api/admin/maintenance", async (request) => {
    requireAdmin(request);
    const input = setMaintenanceInput.parse(request.body);
    return setMaintenance(input.active, input.message);
  });
}
