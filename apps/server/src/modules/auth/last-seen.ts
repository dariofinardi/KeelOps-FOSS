// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ogni quanto vale la pena riscrivere l'ultima attività di un utente.
 *
 * A ogni richiesta sarebbe una scrittura su SQLite per ogni click: caro e
 * inutile, perché la domanda a cui serve rispondere ("questa persona usa
 * l'applicazione?") non ha bisogno del minuto esatto. Si aggiorna quando il
 * valore memorizzato è invecchiato oltre la soglia.
 */
export const LAST_SEEN_THRESHOLD_MINUTES = 5;

export function shouldRefreshLastSeen(
  previous: Date | null | undefined,
  now: Date,
  thresholdMinutes: number = LAST_SEEN_THRESHOLD_MINUTES,
): boolean {
  if (!previous) return true;
  return now.getTime() - previous.getTime() >= thresholdMinutes * 60_000;
}
