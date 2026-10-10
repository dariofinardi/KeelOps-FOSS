// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Il prossimo passo di un'offerta, e quando un'offerta è ferma.**
 *
 * La chiusura prevista dice dove si vuole arrivare; non dice cosa c'è da fare
 * adesso. Il prossimo passo è **il primo task aperto collegato all'offerta**, in
 * ordine di scadenza: quello datato più vicino, poi quelli senza data
 * (17/09/2026). Il 17/09 in produzione 32 offerte aperte su 45 non ne avevano
 * nessuno: per questo, accanto al passo, c'è la nozione di **offerta ferma**.
 *
 * Un'offerta aperta è ferma per tre ragioni, che si contano separate perché
 * chiedono gesti diversi:
 * - `senzaPasso` — nessun task aperto: non c'è niente in programma;
 * - `passoScaduto` — il prossimo passo è già scaduto: era in programma, non è
 *   stato fatto;
 * - `chiusuraPassata` — la chiusura prevista è passata e l'offerta è ancora
 *   aperta: la data va aggiornata o la trattativa chiusa.
 *
 * Le trattative concluse (vinte o perse) non sono mai ferme: sono finite.
 *
 * Le date sono **giorni di calendario** (YYYY-MM-DD) e «oggi» lo decide chi
 * chiama, nel fuso aziendale: una regola che leggesse l'orologio da sola non si
 * potrebbe provare, e sul server e nel browser direbbe due giorni diversi a
 * cavallo della mezzanotte UTC.
 */

export interface PassoCandidato {
  id: string;
  title: string;
  /** Giorno di scadenza (YYYY-MM-DD), o null se il task non ne ha. */
  dueDate: string | null;
  assigneeName: string | null;
}

/** Il primo passo fra i task aperti di un'offerta: il datato più vicino, poi i senza data. */
export function primoPasso<T extends Pick<PassoCandidato, "dueDate">>(aperti: readonly T[]): T | null {
  let migliore: T | null = null;
  for (const task of aperti) {
    if (migliore === null) {
      migliore = task;
      continue;
    }
    if (task.dueDate === null) continue;
    if (migliore.dueDate === null || task.dueDate < migliore.dueDate) migliore = task;
  }
  return migliore;
}

export const StatoPasso = {
  /** Nessun task aperto collegato. */
  NESSUNO: "NESSUNO",
  /** La scadenza è passata. */
  SCADUTO: "SCADUTO",
  /** Scade oggi. */
  OGGI: "OGGI",
  /** Scade da domani in poi. */
  IN_PROGRAMMA: "IN_PROGRAMMA",
  /** C'è un task aperto, ma senza data. */
  SENZA_DATA: "SENZA_DATA",
} as const;
export type StatoPasso = (typeof StatoPasso)[keyof typeof StatoPasso];

export function statoPasso(passo: { dueDate: string | null } | null, oggi: string): StatoPasso {
  if (passo === null) return StatoPasso.NESSUNO;
  if (passo.dueDate === null) return StatoPasso.SENZA_DATA;
  if (passo.dueDate < oggi) return StatoPasso.SCADUTO;
  if (passo.dueDate === oggi) return StatoPasso.OGGI;
  return StatoPasso.IN_PROGRAMMA;
}

/** Le ragioni per cui un'offerta è ferma. L'ordine è quello in cui si mostrano. */
export const MOTIVI_OFFERTA_FERMA = ["senzaPasso", "passoScaduto", "chiusuraPassata"] as const;
export type MotivoOffertaFerma = (typeof MOTIVI_OFFERTA_FERMA)[number];

/** Il filtro «Ferme»: tutte le ferme, oppure una ragione sola. */
export type FiltroOfferteFerme = "tutte" | MotivoOffertaFerma;

export function motiviOffertaFerma(
  offerta: {
    /** Vinta o persa: una trattativa conclusa non è mai ferma. */
    conclusa: boolean;
    passo: { dueDate: string | null } | null;
    expectedCloseDate: string | null;
  },
  oggi: string,
): MotivoOffertaFerma[] {
  if (offerta.conclusa) return [];
  const motivi: MotivoOffertaFerma[] = [];
  const stato = statoPasso(offerta.passo, oggi);
  if (stato === StatoPasso.NESSUNO) motivi.push("senzaPasso");
  if (stato === StatoPasso.SCADUTO) motivi.push("passoScaduto");
  if (offerta.expectedCloseDate !== null && offerta.expectedCloseDate < oggi) {
    motivi.push("chiusuraPassata");
  }
  return motivi;
}

/** L'offerta passa il filtro «Ferme» scelto. */
export function passaFiltroFerme(motivi: readonly MotivoOffertaFerma[], filtro: FiltroOfferteFerme): boolean {
  return filtro === "tutte" ? motivi.length > 0 : motivi.includes(filtro);
}

/**
 * Ordine per prossimo passo, crescente: prima i passi datati dal più vicino (gli
 * scaduti per primi), poi quelli senza data, in fondo le offerte senza passo.
 * Il decrescente è il rovescio esatto. A parità restituisce 0: chi ordina
 * aggiunge il criterio che scioglie (di norma il titolo), così l'ordine non
 * balla fra un caricamento e l'altro.
 */
export function confrontaPerPasso(
  a: { passo: { dueDate: string | null } | null },
  b: { passo: { dueDate: string | null } | null },
): number {
  const rango = (o: { passo: { dueDate: string | null } | null }) =>
    o.passo === null ? 2 : o.passo.dueDate === null ? 1 : 0;
  const differenza = rango(a) - rango(b);
  if (differenza !== 0) return differenza;
  const da = a.passo?.dueDate ?? "";
  const db = b.passo?.dueDate ?? "";
  return da < db ? -1 : da > db ? 1 : 0;
}
