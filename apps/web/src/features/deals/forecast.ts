// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { dealMonthKey, dealWeightPercent } from "@kancrm/shared";

/**
 * Calcolo della previsione, separato dal disegno perché è la parte che deve
 * essere giusta: raggruppa le offerte per mese di chiusura prevista e ne pesa il
 * valore. Il peso lo decide la regola condivisa (`dealWeightPercent`), la stessa
 * che il server usa per la quota mensile: due conti che si confrontano devono
 * uscire dalla stessa formula.
 */

/** Serve solo questo per la previsione: il resto dell'offerta non c'entra. */
export interface ForecastDeal {
  expectedCloseDate: string | null;
  /** Chiusura effettiva: se c'è, è lei a decidere il mese. */
  closedAt?: string | null;
  probability: number | null;
  /**
   * Esito della fase. Facoltativo perché dentro l'azienda la previsione riceve
   * solo trattative aperte; nell'area monitor vendite arrivano tutte.
   */
  stage?: { isWon: boolean; isLost: boolean };
  /** "dealValue" dentro l'azienda, "amount" nell'area monitor vendite. */
  dealValue?: number | null;
  amount?: number | null;
}

/** Peso dell'offerta in percentuale, secondo la regola condivisa. */
export function forecastWeight(deal: ForecastDeal): number {
  return dealWeightPercent({
    value: forecastAmount(deal),
    probability: deal.probability,
    isWon: deal.stage?.isWon,
    isLost: deal.stage?.isLost,
  });
}

export function forecastAmount(deal: ForecastDeal): number {
  return deal.dealValue ?? deal.amount ?? 0;
}

export interface ForecastMonth {
  /** "2026-09", oppure "senza-data". */
  key: string;
  /** Offerte che portano qualcosa: aperte e vinte. */
  count: number;
  total: number;
  weighted: number;
  /** Trattative perse in questo mese: contate a parte, fuori dai totali. */
  lostCount: number;
  /** Il loro importo: anche lui a parte, per chi lo deve vedere (mai sommato). */
  lostTotal: number;
  /**
   * Le vinte, già dentro `count` e `total`: servono a dire quanto del mese è
   * incassato davvero e quanto è ancora un'offerta aperta. In un mese passato la
   * differenza sono le offerte rimaste aperte con la data scaduta.
   */
  wonCount: number;
  wonTotal: number;
}

/**
 * Mesi in ordine di calendario; le offerte senza data di chiusura in fondo.
 *
 * Le **perse restano fuori dai totali**: valgono zero, e sommare il loro importo
 * al "totale" del mese gonfiava un numero che nessuno incasserà — un mese con
 * 50.000 € di trattative perse sembrava un buon mese. Vengono contate a parte,
 * perché sapere che in quel mese se ne sono perse tre è comunque un'informazione.
 */
export function buildForecast(deals: ForecastDeal[]): ForecastMonth[] {
  const byMonth = new Map<string, ForecastMonth>();
  for (const deal of deals) {
    const key = dealMonthKey(deal);
    const bucket = byMonth.get(key) ?? {
      key,
      count: 0,
      total: 0,
      weighted: 0,
      lostCount: 0,
      lostTotal: 0,
      wonCount: 0,
      wonTotal: 0,
    };
    byMonth.set(key, bucket);
    if (deal.stage?.isLost) {
      bucket.lostCount += 1;
      bucket.lostTotal += forecastAmount(deal);
      continue;
    }
    const valore = forecastAmount(deal);
    bucket.count += 1;
    bucket.total += valore;
    bucket.weighted += (valore * forecastWeight(deal)) / 100;
    if (deal.stage?.isWon) {
      bucket.wonCount += 1;
      bucket.wonTotal += valore;
    }
  }
  return [...byMonth.values()].sort((a, b) =>
    a.key === "senza-data" ? 1 : b.key === "senza-data" ? -1 : a.key.localeCompare(b.key),
  );
}

/**
 * Quota condivisa, in italiano: "33,3%". Una cifra decimale sempre, anche sui
 * numeri tondi, così le percentuali di mesi diversi si leggono incolonnate.
 */
export function formatShare(percent: number | null | undefined): string | null {
  if (percent === null || percent === undefined) return null;
  return `${percent.toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * Chiave-mese di "adesso" in ora italiana (unica timezone aziendale): il 31
 * agosto alle 23:30 UTC a Roma è già settembre, e i mesi passati devono
 * diventarlo alla mezzanotte giusta.
 */
export function currentMonthKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
  }).format(now);
}

/**
 * Un mese della previsione è "passato" quando è prima di quello corrente: la
 * vista lo riduce a etichetta per lasciare la scena a quello che deve ancora
 * succedere. "senza-data" non è mai passato — non è nemmeno un mese.
 */
export function isPastForecastMonth(key: string, nowKey: string): boolean {
  return key !== "senza-data" && key < nowKey;
}

/** Somma di più mesi, con la stessa logica dei mesi stessi (perse fuori). */
export function sumForecastMonths(months: ForecastMonth[]): Omit<ForecastMonth, "key"> {
  return months.reduce(
    (acc, m) => ({
      count: acc.count + m.count,
      total: acc.total + m.total,
      weighted: acc.weighted + m.weighted,
      lostCount: acc.lostCount + m.lostCount,
      lostTotal: acc.lostTotal + m.lostTotal,
      wonCount: acc.wonCount + m.wonCount,
      wonTotal: acc.wonTotal + m.wonTotal,
    }),
    { count: 0, total: 0, weighted: 0, lostCount: 0, lostTotal: 0, wonCount: 0, wonTotal: 0 },
  );
}

/**
 * **I mesi che il totale in testa somma** (01/10/2026): da quello corrente a
 * dicembre dello stesso anno, più i mesi passati riaperti dalla pulsantiera. Le
 * offerte **senza data** contano a dicembre (il grafico le sparge sulla prima
 * metà del mese); gli anni dopo restano nell'elenco ma non nel totale, che
 * risponde a «quanto in quest'anno».
 */
export function isInForecastTotal(
  key: string,
  nowKey: string,
  reopened: readonly string[],
): boolean {
  if (key === "senza-data") return true;
  if (reopened.includes(key)) return true;
  return key >= nowKey && key <= `${nowKey.slice(0, 4)}-12`;
}
