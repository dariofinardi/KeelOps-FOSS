// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { dealForecastDate, dealMonthKey, SENZA_DATA, weekStartOf } from "@kancrm/shared";
import { forecastAmount, forecastWeight, isInForecastTotal, type ForecastDeal } from "./forecast";

/**
 * **La previsione per settimana** (01/10/2026): i numeri del grafico sotto il
 * totale, calcolati sulla stessa selezione — da questo mese a dicembre, più i
 * mesi passati riaperti (`isInForecastTotal`). Le perse restano fuori, come nei
 * totali.
 *
 * Un'offerta **senza data** si conta a dicembre, sparsa sui primi quindici
 * giorni: tutte il primo del mese farebbero una settimana enorme che non vuol
 * dire niente, e sparse si leggono per quello che sono — «da qualche parte
 * entro l'anno».
 */

export interface ForecastWeek {
  /** Il lunedì della settimana (YYYY-MM-DD). */
  start: string;
  /** La domenica. */
  end: string;
  count: number;
  /** Il totale nominale e il pesato, come nei mesi. */
  total: number;
  weighted: number;
  /** Fra le offerte con un importo: il più piccolo, il più grande, la media. Null se nessuna ce l'ha. */
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface ForecastKpi {
  count: number;
  total: number;
  weighted: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  wonCount: number;
  wonTotal: number;
  /** Quante delle offerte contate non avevano una data (sparse a dicembre). */
  undatedCount: number;
}

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** I lunedì delle settimane che toccano un mese, in ordine. */
function weeksOfMonthKey(key: string): string[] {
  const first = `${key}-01`;
  const lunedi: string[] = [];
  for (let day = weekStartOf(first); day.slice(0, 7) <= key; day = addDays(day, 7)) {
    lunedi.push(day);
  }
  return lunedi;
}

/** Il giorno in cui la i-esima di n offerte senza data cade: sparse dall'1 al 15 dicembre. */
export function undatedDay(index: number, count: number, year: string): string {
  const day = 1 + Math.floor((index * 15) / Math.max(1, count));
  return `${year}-12-${String(day).padStart(2, "0")}`;
}

const stats = (values: number[]) =>
  values.length === 0
    ? { min: null, max: null, avg: null }
    : {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
      };

export function buildForecastWeeks(
  deals: ForecastDeal[],
  nowKey: string,
  reopened: readonly string[],
  /**
   * Mesi scelti nel filtro per mese (03/10/2026): se ci sono, il periodo sono
   * loro e non più «da questo mese a dicembre». Le offerte senza data restano
   * sparse a dicembre dell'anno corrente, e ci sono se «senza-data» è scelto.
   */
  scelti: readonly string[] = [],
): { weeks: ForecastWeek[]; kpi: ForecastKpi } {
  const year = nowKey.slice(0, 4);
  const vive = deals.filter((deal) => !deal.stage?.isLost);
  const senzaData = vive.filter((deal) => dealForecastDate(deal) === null);
  const datate = vive
    .map((deal) => {
      const own = dealForecastDate(deal);
      return { deal, day: own ?? undatedDay(senzaData.indexOf(deal), senzaData.length, year) };
    })
    .filter(({ deal, day }) =>
      scelti.length > 0
        ? scelti.includes(dealMonthKey(deal))
        : isInForecastTotal(day.slice(0, 7), nowKey, reopened),
    );

  // Le settimane dei mesi del periodo, anche vuote: il grafico ha un ritmo regolare.
  const mesi = new Set<string>();
  if (scelti.length > 0) {
    for (const key of scelti) mesi.add(key === SENZA_DATA ? `${year}-12` : key);
  } else {
    for (const key of reopened) if (key < nowKey) mesi.add(key);
    for (let m = nowKey; m <= `${year}-12`; m = nextMonth(m)) mesi.add(m);
  }
  const lunedi = [...new Set([...mesi].flatMap(weeksOfMonthKey))].sort();

  const perSettimana = new Map<string, Array<{ deal: ForecastDeal; day: string }>>();
  for (const voce of datate) {
    const start = weekStartOf(voce.day);
    perSettimana.set(start, [...(perSettimana.get(start) ?? []), voce]);
  }

  const weeks = lunedi.map((start) => {
    const voci = perSettimana.get(start) ?? [];
    const importi = voci
      .map(({ deal }) => deal.dealValue ?? deal.amount ?? null)
      .filter((v): v is number => v !== null);
    return {
      start,
      end: addDays(start, 6),
      count: voci.length,
      total: voci.reduce((sum, { deal }) => sum + forecastAmount(deal), 0),
      weighted: voci.reduce(
        (sum, { deal }) => sum + (forecastAmount(deal) * forecastWeight(deal)) / 100,
        0,
      ),
      ...stats(importi),
    };
  });

  const tutti = datate
    .map(({ deal }) => deal.dealValue ?? deal.amount ?? null)
    .filter((v): v is number => v !== null);
  const vinte = datate.filter(({ deal }) => deal.stage?.isWon);
  return {
    weeks,
    kpi: {
      count: datate.length,
      total: weeks.reduce((sum, w) => sum + w.total, 0),
      weighted: weeks.reduce((sum, w) => sum + w.weighted, 0),
      ...stats(tutti),
      wonCount: vinte.length,
      wonTotal: vinte.reduce((sum, { deal }) => sum + forecastAmount(deal), 0),
      undatedCount: datate.filter(({ deal }) => dealForecastDate(deal) === null).length,
    },
  };
}

function nextMonth(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
