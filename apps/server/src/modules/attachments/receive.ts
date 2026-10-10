// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { attachmentLabel, AttachmentType, isAllowedTicketAttachment } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest } from "../../lib/http-errors";
import { sanitizeFilename } from "./storage";
import { attachmentStore } from "./store";
import { extraAttachmentExtensions } from "./extensions";
import { logActivity } from "../tasks/activity";
import type { User } from "../../generated/prisma/client";

/**
 * **Ricevere un file da fuori**: dalla porta delle integrazioni (osTicket) e da
 * quella del modulo iniettabile.
 *
 * Stava dentro `integrations/routes.ts`, dove l'aveva scritto chi serviva per
 * primo. Il modulo iniettabile ha lo stesso bisogno con la stessa disciplina —
 * formati ammessi, file su disco FUORI dalla transazione (SQLite tiene il lock
 * in scrittura), file rimosso se il database dice no — e ricopiarla voleva dire
 * due elenchi di formati che al primo ritocco divergono.
 *
 * Formati ammessi, file su disco **fuori** dalla transazione (SQLite tiene il
 * lock in scrittura) e rimosso se il database dice no. L'autore è chi ha creato
 * il record: prenderlo da lì evita che una chiamata sbagliata attribuisca
 * l'allegato a un altro.
 */

/** Il file com'è arrivato: dal multipart (campo file) o dal corpo grezzo. */
export async function readUploadedFile(
  request: FastifyRequest,
): Promise<{ filename: string; mimetype: string; buffer: Buffer }> {
  if (request.isMultipart()) {
    const file = await request.file();
    if (!file) throw badRequest("Nessun file ricevuto");
    // il limite di dimensione è quello di @fastify/multipart
    return { filename: file.filename, mimetype: file.mimetype, buffer: await file.toBuffer() };
  }
  const headerName = request.headers["x-filename"];
  const query = request.query as { filename?: string };
  const filename = (Array.isArray(headerName) ? headerName[0] : headerName) ?? query.filename;
  if (!filename || !filename.trim()) {
    throw badRequest(
      "File grezzo senza nome: indica il nome del file nell'intestazione X-Filename (o in ?filename=), oppure manda multipart/form-data col campo «file»",
    );
  }
  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest("Nessun file ricevuto");
  const mimetype = String(request.headers["content-type"] ?? "application/octet-stream")
    .split(";")[0]!
    .trim();
  return { filename: decodeURIComponent(filename.trim()), mimetype, buffer: body };
}

export async function receiveFileFor(
  request: FastifyRequest,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  taskId: string,
  author: User,
) {
  const ricevuto = await readUploadedFile(request);
  const filename = sanitizeFilename(ricevuto.filename);
  const extra = await extraAttachmentExtensions();
  if (!isAllowedTicketAttachment(filename, extra)) {
    throw badRequest("Formato non ammesso: allega {{formats}}", {
      formats: attachmentLabel(extra),
    });
  }
  const { buffer } = ricevuto;
  const relativePath = path.join(taskId, `${randomUUID()}-${filename}`);
  await attachmentStore().write(relativePath, buffer);
  try {
    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          type: AttachmentType.FILE,
          name: filename,
          mimeType: ricevuto.mimetype,
          size: buffer.length,
          path: relativePath,
          uploadedById: author.id,
          tasks: { create: { taskId } },
        },
      });
      await logActivity(tx, taskId, author.id, "attachment_added", {
        name: filename,
        type: "FILE",
      });
      return created;
    });
    return reply.status(201).send({ id: attachment.id, name: attachment.name });
  } catch (error) {
    await attachmentStore().remove(relativePath);
    throw error;
  }
}
