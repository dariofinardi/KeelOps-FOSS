// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { readUpTo } from "../../lib/read-limited";
import { perUtente } from "../../lib/rate-limit";
import { prisma } from "../../db";
import { badRequest, notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { attachmentStore } from "../attachments/store";
import { assertTaskEditAccess, assertTaskViewAccess } from "../tasks/routes";
import {
  assertPastableImage,
  MAX_IMAGE_BYTES,
  imageTypeOf,
  inlinePath,
  inlineUrl,
  pendingKey,
  storePendingImage,
} from "./inline-images";

/**
 * Le figure incollate dentro una descrizione.
 *
 * Sono un'altra cosa dagli allegati, e per un motivo pratico: uno scatto di
 * schermo incollato in mezzo a una frase **è la frase**, non un documento del
 * task. Metterlo tra gli allegati riempirebbe quell'elenco di ritagli senza
 * nome, e il primo a lamentarsene sarebbe chi cerca il contratto.
 *
 * Vivono quindi accanto al task (`<uploads>/<taskId>/_inline/`) e si leggono da
 * una rotta che chiede il permesso allo stesso posto di tutto il resto: chi
 * vede il task vede le sue figure, chi non lo vede prende 404 come se il task
 * non esistesse.
 *
 * Due porte d'ingresso, stesse regole (tipo, dimensione, cartella):
 *  - sul task, quando il record c'è già;
 *  - in **attesa**, quando lo si sta ancora scrivendo (vedi `inline-images.ts`).
 */

/**
 * Il tipo si controlla PRIMA di leggere, e si legge fino al tetto delle
 * figure (5 MB), non fino a quello dei caricamenti (80 MB): un file da 79 MB
 * finiva tutto in memoria solo per sentirsi dire «troppo grande».
 */
async function leggiImmagine(file: MultipartFile): Promise<Buffer> {
  assertPastableImage(file.mimetype, 0);
  const { buffer, troppoGrande } = await readUpTo(file.file, MAX_IMAGE_BYTES);
  if (troppoGrande) throw badRequest("Immagine troppo grande: il limite è 5 MB");
  return buffer;
}

/** Serve i byte di una figura: stessa risposta per entrambe le rotte. */
async function sendImage(reply: FastifyReply, key: string, type: string) {
  const buffer = await attachmentStore()
    .read(key)
    .catch(() => null);
  if (!buffer) throw notFound("Immagine non trovata");
  // Il nome contiene già un identificativo unico: il file a quel nome non
  // cambia mai, quindi il browser può tenerselo.
  return reply.type(type).header("Cache-Control", "private, max-age=86400").send(buffer);
}

export function richTextRoutes(app: FastifyInstance): void {
  /** Carica una figura incollata nella descrizione di un task. */
  app.post(
    "/api/tasks/:id/inline-images",
    { config: { rateLimit: perUtente(30, "1 minute") } },
    async (request, reply) => {
      const user = requireUser(request);
      const { id } = request.params as { id: string };
      const task = await prisma.task.findUnique({ where: { id } });
      if (!task) throw notFound("Task non trovato");
      // Scrivere una figura dentro la descrizione è modificare la descrizione.
      await assertTaskEditAccess(user, task);

      const file = await request.file();
      if (!file) throw badRequest("Nessuna immagine ricevuta");
      const buffer = await leggiImmagine(file);
      const extension = assertPastableImage(file.mimetype, buffer.length);

      const filename = `${randomUUID()}${extension}`;
      await attachmentStore().write(inlinePath(id, filename), buffer);
      // L'indirizzo è relativo: la descrizione se lo porta dietro in ogni copia
      // del database, e resta valido anche se cambia il nome del server.
      return reply.status(201).send({ url: inlineUrl(id, filename) });
    },
  );

  /**
   * Carica una figura incollata in una descrizione **non ancora salvata**: non
   * c'è un record a cui appoggiarla, quindi resta in attesa a nome di chi
   * l'ha incollata. Al salvataggio trasloca accanto al record (vedi
   * `claimInlineImages`); se il dialogo viene abbandonato la spazza il cron.
   */
  app.post(
    "/api/inline-images",
    { config: { rateLimit: perUtente(30, "1 minute") } },
    async (request, reply) => {
      const user = requireUser(request);
      const file = await request.file();
      if (!file) throw badRequest("Nessuna immagine ricevuta");
      const buffer = await leggiImmagine(file);
      const extension = assertPastableImage(file.mimetype, buffer.length);
      const url = await storePendingImage(user.id, buffer, extension);
      return reply.status(201).send({ url });
    },
  );

  /**
   * Rilegge una figura in attesa. La vede **solo chi l'ha incollata**: finché
   * il record non esiste non c'è nessun permesso da ereditare, e l'unica
   * persona che deve vederla è quella che la sta scrivendo.
   */
  app.get("/api/inline-images/pending/:filename", async (request, reply) => {
    const user = requireUser(request);
    const { filename } = request.params as { filename: string };
    const extension = path.extname(filename).toLowerCase();
    const type = imageTypeOf(extension);
    const id = path.basename(filename, extension).toLowerCase();
    if (!type) throw notFound("Immagine non trovata");

    const image = await prisma.pendingInlineImage.findUnique({ where: { id } });
    if (!image || image.uploadedById !== user.id) throw notFound("Immagine non trovata");
    return sendImage(reply, pendingKey(image.id, image.ext), type);
  });

  /** Rilegge una figura: la vede chi vede il task. */
  app.get("/api/tasks/:id/inline/:filename", async (request, reply) => {
    const user = requireUser(request);
    const { id, filename } = request.params as { id: string; filename: string };
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Immagine non trovata");
    await assertTaskViewAccess(user, task);

    const type = imageTypeOf(path.extname(filename));
    if (!type) throw notFound("Immagine non trovata");
    return sendImage(reply, inlinePath(id, filename), type);
  });
}
