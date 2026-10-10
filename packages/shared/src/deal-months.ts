// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { dealForecastDate } from "./deal-weight";

/**
 * **Il mese di un'offerta** (03/10/2026): quello della data che conta per la
 * previsione — la chiusura effettiva se c'è, altrimenti la prevista — oppure
 * `senza-data`. Una regola sola per il filtro per mese della tabella, del kanban,
 * della previsione e del pannello investitori, e per i gruppi della previsione:
 * scritta due volte, un'offerta finirebbe in un mese nel filtro e in un altro nel
 * grafico.
 *
 * Le date sono giorni UTC (`YYYY-MM-DD`), come nel resto del modello: il mese è
 * il prefisso.
 */
export const SENZA_DATA = "senza-data";

const CHIAVE_MESE = /^(\d{4}-(0[1-9]|1[0-2])|senza-data)$/;

export function dealMonthKey(deal: {
  closedAt?: string | null;
  expectedCloseDate?: string | null;
}): string {
  return dealForecastDate(deal)?.slice(0, 7) ?? SENZA_DATA;
}

/** Una chiave valida: `2026-09` o `senza-data`. */
export function isDealMonthKey(value: string): boolean {
  return CHIAVE_MESE.test(value);
}

/**
 * Il filtro scritto in una query string: `2026-09,2026-10,senza-data`. Le voci
 * non valide si scartano (un preferito salvato vecchio non deve rompere la
 * pagina), i doppioni pure; vuoto = nessun filtro.
 */
export function parseDealMonths(value: string | null | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((v) => v.trim())
        .filter(isDealMonthKey),
    ),
  ].sort();
}

/** L'offerta cade in uno dei mesi scelti? Nessun mese scelto = sì. */
export function matchesDealMonths(
  deal: { closedAt?: string | null; expectedCloseDate?: string | null },
  months: readonly string[],
): boolean {
  return months.length === 0 || months.includes(dealMonthKey(deal));
}

/** Primo giorno del mese e del mese dopo, in UTC: gli estremi `[da, a)` di una query. */
export function monthRangeUTC(key: string): { da: Date; a: Date } {
  const [anno, mese] = key.split("-").map(Number) as [number, number];
  return {
    da: new Date(Date.UTC(anno, mese - 1, 1)),
    a: new Date(Date.UTC(anno, mese, 1)),
  };
}
