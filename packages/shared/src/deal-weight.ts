// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Quanto vale davvero un'offerta nei conti previsionali.
 *
 * Sta qui, e non da una parte sola, perché la stessa regola serve al frontend
 * (che disegna la previsione) e al server (che calcola quanta parte del mese è
 * condivisa con i monitor vendite): due formule scritte due volte divergono al
 * primo ritocco, e il confronto fra le due grandezze non tornerebbe più.
 */

export interface WeighableDeal {
  /** Importo dichiarato dell'offerta. */
  value: number | null | undefined;
  /** Probabilità di chiusura, 0-100. */
  probability: number | null | undefined;
  isWon?: boolean;
  isLost?: boolean;
}

/**
 * Peso in percentuale: una trattativa chiusa non è più una previsione ma un
 * fatto — vinta vale tutto, persa non vale niente. La probabilità dichiarata dal
 * commerciale conta solo finché l'esito è aperto.
 */
export function dealWeightPercent(deal: WeighableDeal): number {
  if (deal.isWon) return 100;
  if (deal.isLost) return 0;
  return deal.probability ?? 0;
}

/** Valore atteso: importo per peso. È questo il numero su cui si fanno i conti. */
export function dealWeightedValue(deal: WeighableDeal): number {
  return ((deal.value ?? 0) * dealWeightPercent(deal)) / 100;
}

/**
 * Il mese sotto cui un'offerta va contata: quello della **chiusura effettiva** se
 * la trattativa è conclusa, altrimenti quello previsto.
 *
 * Un affare vinto il 31 luglio è denaro di luglio, anche se a suo tempo si sperava
 * di chiuderlo in giugno: contarlo sulla data sperata sposterebbe soldi veri in un
 * mese in cui non sono arrivati. Le offerte ancora aperte non hanno una chiusura
 * effettiva, e restano sulla previsione.
 */
export function dealForecastDate(deal: {
  closedAt?: string | null;
  expectedCloseDate?: string | null;
}): string | null {
  return deal.closedAt ?? deal.expectedCloseDate ?? null;
}

/**
 * Tariffa convenzionale per tradurre il valore di un'offerta in giornate di
 * lavoro: è l'unità in cui la pipeline parla agli sviluppatori, che ragionano
 * in capacità e non in fatturato.
 */
export const DEV_DAY_RATE = 500;

/**
 * Giornate equivalenti, **intere**: si lavora a giornate, non a frazioni, quindi
 * da metà in su si arrotonda per eccesso (1,5 → 2) e sotto per difetto
 * (1,2 → 1). Null se l'offerta non ha un valore.
 */
export function dealValueToDays(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(value / DEV_DAY_RATE);
}
