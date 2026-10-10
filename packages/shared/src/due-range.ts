// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Filtro "range di scadenza" delle liste task (7/15/30/60 giorni, tutte).
 *
 * Un range attivo mostra: i task **già scaduti**, quelli in scadenza entro N
 * giorni, e **quelli senza data**.
 *
 * I senza data restavano fuori, e il filtro serviva "a concentrarsi sulle
 * scadenze". Ma in una bacheca kanban il filtro lo si usa per stringere il
 * campo, non per nascondere il lavoro: un task senza scadenza non è un task
 * finito — è lavoro in corso a cui nessuno ha messo una data — e vederlo
 * sparire da una colonna leggeva come un record perso (10/09/2026).
 *
 * La stessa regola gira sul server (Scadenzario, query) e sul client
 * (Progetti, lista in mano): sono due implementazioni della stessa frase, e
 * vanno cambiate insieme.
 */
export const DUE_RANGE_OPTIONS = [7, 15, 30, 60] as const;

/** Ultimo giorno incluso nel range (YYYY-MM-DD). */
export function dueRangeEnd(today: string, days: number): string {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  return end.toISOString().slice(0, 10);
}

/** true se il task passa il filtro (nessun range = passa tutto). */
export function inDueRange(dueDate: string | null, days: number | null, today: string): boolean {
  if (days === null) return true;
  // Senza data si passa: il filtro stringe sulle scadenze, non nasconde il
  // lavoro che una scadenza non ce l'ha.
  if (!dueDate) return true;
  return dueDate <= dueRangeEnd(today, days);
}
