// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";

/**
 * **Un tetto per persona, non per indirizzo.** Il limitatore globale è spento
 * (`app.ts`): lo si accende rotta per rotta, e su quelle che con una sessione
 * valida — o rubata — costano o disturbano senza limite (V4 di PLAN_OPTIMIZE):
 * caricamenti, figure incollate, messaggi, push di prova, cambio password. La
 * chiave è chi è dentro; senza sessione (non dovrebbe succedere oltre la
 * guardia) l'indirizzo. Le soglie sono larghe: chi lavora non le tocca.
 *
 * `preHandler` e non `onRequest`: l'utente lo mette la guardia, che è un
 * `onRequest` registrato prima.
 */
export function perUtente(max: number, timeWindow: string) {
  return {
    max,
    timeWindow,
    hook: "preHandler" as const,
    keyGenerator: (request: FastifyRequest): string => request.currentUser?.id ?? request.ip,
  } as const;
}

/**
 * Per le integrazioni, che entrano con un bearer e non con una sessione: la
 * chiave è l'impronta del token, così un client che esagera non ferma gli
 * altri. Il token stesso non finisce in memoria in chiaro.
 */
export function perToken(max: number, timeWindow: string) {
  return {
    max,
    timeWindow,
    keyGenerator: (request: FastifyRequest): string => {
      const auth = request.headers.authorization ?? "";
      return auth ? createHash("sha256").update(auth).digest("hex").slice(0, 32) : request.ip;
    },
  } as const;
}
