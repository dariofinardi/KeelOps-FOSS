import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db";
import { requireUser } from "../../plugins/auth";
import { perUtente } from "../../lib/rate-limit";
import { getVapidPublicKey, pushToUser } from "./service";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export function pushRoutes(app: FastifyInstance): void {
  app.get("/api/push/public-key", async (request) => {
    requireUser(request);
    return { publicKey: await getVapidPublicKey() };
  });

  // Registra questo dispositivo/browser per le notifiche push.
  app.post("/api/push/subscribe", async (request, reply) => {
    const user = requireUser(request);
    const input = subscribeSchema.parse(request.body);
    await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth },
      create: {
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    });
    return reply.status(204).send();
  });

  /**
   * Notifica di prova a sé stessi.
   *
   * Le push si possono solo provare: fra il browser, il permesso, il service
   * worker e il servizio di Google ci sono quattro punti in cui la cosa può
   * fermarsi in silenzio, e nessuno di questi si vede dall'applicazione. Dice
   * anche **a quanti dispositivi** è partita: "non è arrivato niente" e "non
   * c'era nessun dispositivo iscritto" sono due diagnosi diverse.
   */
  // Un invio a Google per richiesta: pochi al minuto bastano a provare un dispositivo.
  app.post(
    "/api/push/test",
    { config: { rateLimit: perUtente(5, "1 minute") } },
    async (request) => {
      const user = requireUser(request);
      const delivered = await pushToUser(
        user.id,
        "KeelOps",
        "Notifica di prova: se la leggi, le notifiche di questo dispositivo funzionano.",
      );
      return { delivered };
    },
  );

  app.post("/api/push/unsubscribe", async (request, reply) => {
    const user = requireUser(request);
    const { endpoint } = z.object({ endpoint: z.string() }).parse(request.body);
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } });
    return reply.status(204).send();
  });
}
