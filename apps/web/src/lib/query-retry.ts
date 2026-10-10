// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { ApiError } from "./api";

/**
 * **Quando vale la pena ritentare una richiesta.**
 *
 * Mai su un 4xx: la risposta non cambierà: un 404 è un 404, un 403 pure. E
 * ritentare costa due volte — la riga doppia in console (che è come ce ne siamo
 * accorti, 20/08/2026) e soprattutto il **tempo prima di dirlo a chi guarda**,
 * che intanto vede "Caricamento…" per una cosa che non arriverà mai.
 *
 * Un tentativo in più invece serve dove il guasto può essere passeggero: rete
 * caduta, server che si sta riavviando, 502 del proxy.
 */
export function riprovaQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}
