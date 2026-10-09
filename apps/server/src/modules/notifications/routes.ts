import type { FastifyInstance } from "fastify";
import {
  notificationTypesFor,
  updateEmailDigestSchema,
  updateNotificationPreferenceSchema,
  type NotificationDto,
} from "@kancrm/shared";
import { config } from "../../config";
import { prisma } from "../../db";
import { notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import type { Notification } from "../../generated/prisma/client";
import { addSseListener } from "./service";
import { senzaTipiAssenti, tipiNotificaPrevisti } from "../../edition/notification-types";

function toDto(notification: Notification): NotificationDto {
  const payload = JSON.parse(notification.payload) as {
    text?: string;
    taskId?: string;
    taskKind?: string;
  };
  return {
    id: notification.id,
    type: notification.type as NotificationDto["type"],
    text: payload.text ?? "",
    taskId: payload.taskId ?? null,
    taskKind: payload.taskKind ?? null,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function notificationRoutes(app: FastifyInstance): void {
  app.get("/api/notifications", async (request) => {
    const user = requireUser(request);
    // `inApp: false` è una notifica scritta solo per tenere il conto (l'email è
    // partita, la campanella no): nell'elenco non ci va, o l'interruttore che si
    // è appena spento non avrebbe spento niente.
    // I tipi dei moduli assenti (una community su un database commerciale)
    // non si mostrano: nella commerciale il filtro è vuoto.
    const filtro = senzaTipiAssenti();
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id, inApp: true, ...filtro },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({
        where: { userId: user.id, inApp: true, readAt: null, ...filtro },
      }),
    ]);
    return { notifications: notifications.map(toDto), unreadCount };
  });

  app.post("/api/notifications/:id/read", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== user.id) throw notFound("Notifica non trovata");
    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return reply.status(204).send();
  });

  app.post("/api/notifications/read-all", async (request, reply) => {
    const user = requireUser(request);
    await prisma.notification.updateMany({
      where: { userId: user.id, inApp: true, readAt: null },
      data: { readAt: new Date() },
    });
    return reply.status(204).send();
  });

  // Server-Sent Events: push in tempo reale delle nuove notifiche.
  app.get("/api/notifications/stream", async (request, reply) => {
    const user = requireUser(request);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(": connesso\n\n");

    const removeListener = addSseListener(user.id, (data) => reply.raw.write(data));
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 30_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      removeListener();
    });
    // La risposta resta aperta: non ritornare nulla.
    await new Promise(() => undefined);
  });

  app.get("/api/notification-preferences", async (request) => {
    const user = requireUser(request);
    const [rows, persona] = await Promise.all([
      prisma.notificationPreference.findMany({ where: { userId: user.id } }),
      prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { emailDigest: true, emailWeekend: true },
      }),
    ]);
    const byType = new Map(rows.map((row) => [row.type, row]));
    const previsti = tipiNotificaPrevisti();
    // Chi non ha mai scelto ha tutto acceso: l'elenco è completo, senza righe in
    // tabella finché non si tocca qualcosa. Quali tipi siano «tutti» dipende da
    // chi guarda: al cliente del portale non si offre il limite WIP.
    return {
      items: notificationTypesFor(user.role)
        .filter((type) => previsti.has(type))
        .map((type) => ({
          type,
          enabled: byType.get(type)?.enabled ?? true,
          email: byType.get(type)?.email ?? true,
        })),
      emailDigest: persona.emailDigest,
      emailWeekend: persona.emailWeekend,
      emailDigestMinutes: config.emailDigestMinutes,
    };
  });

  /**
   * **Le email raccolte in un riepilogo**, o una per una. È una scelta sola per
   * tutta la posta — non per tipo — perché il problema che risolve è il numero
   * di messaggi, non quali siano.
   */
  app.put("/api/notification-preferences/aggregation", async (request) => {
    const user = requireUser(request);
    const scelta = updateEmailDigestSchema.parse(request.body);
    const persona = await prisma.user.update({
      where: { id: user.id },
      data: scelta,
      select: { emailDigest: true, emailWeekend: true },
    });
    /**
     * Spegnendo l'aggregazione, ciò che era in coda **non si perde e non
     * arriva tutto insieme**: resta lì, e il prossimo giro del riepilogo lo
     * porta via. Mandarlo subito, una email per avviso, sarebbe esattamente la
     * valanga da cui si stava scappando.
     */
    return persona;
  });

  app.put("/api/notification-preferences", async (request) => {
    const user = requireUser(request);
    const input = updateNotificationPreferenceSchema.parse(request.body);
    // Si aggiorna solo il canale nominato: l'altro resta com'è (e se la riga non
    // c'era ancora, nasce acceso — è il valore di chi non ha mai scelto).
    const cambio = {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.email === undefined ? {} : { email: input.email }),
    };
    const riga = await prisma.notificationPreference.upsert({
      where: { userId_type: { userId: user.id, type: input.type } },
      update: cambio,
      create: { userId: user.id, type: input.type, ...cambio },
    });
    return { type: riga.type, enabled: riga.enabled, email: riga.email };
  });
}
