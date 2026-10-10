// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client";
import { config } from "../config";
import { localeFromRequest, serverT } from "../i18n";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((rawError: unknown, request, reply) => {
    // La lingua di chi ha fatto la richiesta: i messaggi d'errore escono lì.
    // Il messaggio italiano È la chiave; ciò che non è tradotto resta italiano.
    const locale = localeFromRequest(request);
    const tr = (message: string, params?: Record<string, string | number>) =>
      serverT(locale, message, params);

    /**
     * File troppo grande: `@fastify/multipart` alza la sua eccezione con un
     * messaggio inglese e tecnico ("request file too large"), che l'utente
     * riceveva così com'era. Chi carica un video dal telefono deve leggere
     * **qual è il limite**, in italiano, altrimenti riprova con lo stesso file
     * (18/08/2026).
     */
    if (
      rawError instanceof Error &&
      (rawError as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE"
    ) {
      return reply.status(413).send({
        error: "FILE_TOO_LARGE",
        message: tr("Il file supera il limite di {{max}} MB per allegato", {
          max: config.maxUploadMb,
        }),
      });
    }

    /**
     * Content-Type che nessun parser conosce: Fastify risponde "Unsupported
     * Media Type" e basta, e chi integra non capisce cosa mandare (31/08/2026,
     * un CSV grezzo sull'API). Si dice cosa accetta ogni porta.
     */
    if (
      rawError instanceof Error &&
      (rawError as { code?: string }).code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
    ) {
      return reply.status(415).send({
        error: "UNSUPPORTED_MEDIA_TYPE",
        message: tr(
          "Content-Type non supportato: i dati viaggiano in application/json; gli allegati in multipart/form-data (campo «file») oppure come file grezzo col suo tipo e il nome in X-Filename",
        ),
      });
    }

    if (rawError instanceof ZodError) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: tr("Dati non validi"),
        issues: rawError.issues,
      });
    }

    // Errori noti di Prisma → codici HTTP leggibili invece di 500 generici.
    if (rawError instanceof Prisma.PrismaClientKnownRequestError) {
      if (rawError.code === "P2002") {
        const target = rawError.meta?.target;
        const field = Array.isArray(target) ? target.join(", ") : (target ?? "");
        return reply.status(409).send({
          error: "CONFLICT",
          message: field
            ? tr("Valore già esistente: {{field}}", { field: String(field) })
            : tr("Valore già esistente"),
        });
      }
      if (rawError.code === "P2025") {
        return reply.status(404).send({ error: "NOT_FOUND", message: tr("Record non trovato") });
      }
      if (rawError.code === "P2003") {
        return reply
          .status(400)
          .send({ error: "FK_CONSTRAINT", message: tr("Riferimento non valido") });
      }
    }

    const error = rawError as FastifyError & {
      i18nKey?: string;
      i18nParams?: Record<string, string | number>;
    };
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error(error);
    }
    const fallbackCode =
      statusCode === 429 ? "RATE_LIMITED" : statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "ERROR";
    // Sotto i 500 il messaggio è una frase pensata per l'utente: si traduce dalla
    // sua chiave italiana (`i18nKey`, se l'errore la porta) interpolando i valori.
    // I valori STRINGA si traducono anch'essi (così "Assegnatario" diventa
    // "Assignee"), ma i numeri restano numeri — servono ai plurali; i dati come
    // titoli o nomi non sono chiavi del catalogo e passano invariati.
    const translatedParams = error.i18nParams
      ? Object.fromEntries(
          Object.entries(error.i18nParams).map(([k, v]) => [
            k,
            typeof v === "number" ? v : serverT(locale, v),
          ]),
        )
      : undefined;
    return reply.status(statusCode).send({
      error: error.code ?? fallbackCode,
      message:
        statusCode >= 500
          ? tr("Errore interno del server")
          : tr(error.i18nKey ?? error.message, translatedParams),
    });
  });
}
