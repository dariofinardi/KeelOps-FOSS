import type { FastifyInstance } from "fastify";
import { UserRole } from "@kancrm/shared";
import { forbidden, notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { isAnyManager } from "../visibility/service";
import { cancelJob, listJobs } from "./llm-queue";

/**
 * La Coda AI. Stava fra le rotte dei progetti; dall'08/10/2026 è del nucleo,
 * in tutte e due le edizioni (i lavori che la riempiono possono essere
 * commerciali: nota di rilascio, newsletter, lettura dei contratti).
 */
export function llmJobRoutes(app: FastifyInstance): void {
  /**
   * **Il pannello della coda**, per chi **guida qualcosa** — un gruppo o un
   * progetto, l'ambito non conta (`isAnyManager`). È una risorsa condivisa e
   * lenta: sorvegliarla è un compito di chi guida del lavoro, non di chi
   * amministra il sistema.
   *
   * Si vede la coda **intera**, non solo la propria: una fila di cui si vede
   * metà non dice a che punto si è — "la mia non parte" senza poter vedere
   * cosa la precede è peggio di nessun pannello. Passano dei nomi di progetto e
   * di persona, ma fra manager interni e su un dato operativo è il prezzo
   * giusto per un numero che significhi qualcosa. **Fermare** resta ristretto:
   * le proprie sempre, quelle altrui solo da admin.
   */
  app.get("/api/llm-jobs", async (request) => {
    const user = requireUser(request);
    if (!(await isAnyManager(user))) {
      throw forbidden("Riservato a chi guida un gruppo o un progetto");
    }
    return { jobs: listJobs() };
  });

  /**
   * Ferma o toglie dalla coda. In fila sparisce subito; in esecuzione passa per
   * `removing` e ci mette qualche secondo — il tempo che la richiesta in volo
   * si interrompa e il ciclo si chiuda.
   */
  app.delete("/api/llm-jobs/:jobId", async (request, reply) => {
    const user = requireUser(request);
    const { jobId } = request.params as { jobId: string };
    const done = cancelJob(jobId, {
      userId: user.id,
      isAdmin: user.role === UserRole.ADMIN,
    });
    if (!done) throw notFound("Richiesta non trovata");
    return reply.status(204).send();
  });
}
