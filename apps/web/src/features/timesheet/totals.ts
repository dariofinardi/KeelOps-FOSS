// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { TimesheetRow } from "@kancrm/shared";

/**
 * Totali della griglia mensile: per giorno, del mese, e il giudizio su una
 * giornata che non torna.
 *
 * Stanno qui e non dentro la tabella perché servono aggiornati **mentre si
 * scrive**: chi compila il timesheet controlla il piede della colonna per
 * accorgersi di aver messo 12 ore in un martedì, e aspettare il salvataggio per
 * saperlo è tardi. Le ore ancora nella casella (`drafts`) pesano quindi come
 * quelle già registrate.
 */

/** Chiave di una casella: la coppia task+giorno è unica nella griglia. */
export const cellKey = (taskId: string, date: string) => `${taskId}|${date}`;

/** Ore di una casella: quelle che si stanno scrivendo, o quelle salvate. */
export function cellHours(
  row: TimesheetRow,
  date: string,
  drafts: Record<string, number> = {},
): number {
  return drafts[cellKey(row.task.id, date)] ?? row.entries[date] ?? 0;
}

export function dayTotals(
  rows: TimesheetRow[],
  dates: string[],
  drafts: Record<string, number> = {},
): number[] {
  return dates.map((date) => rows.reduce((sum, row) => sum + cellHours(row, date, drafts), 0));
}

export function monthTotal(totals: number[]): number {
  return totals.reduce((sum, hours) => sum + hours, 0);
}

/**
 * Come sta messa una giornata:
 * - `impossibile`: più ore di quante ne abbia un giorno — il server le rifiuta;
 * - `oltre`: più di una giornata di lavoro, forse un errore di battitura;
 * - `ok`: tutto normale.
 *
 * Con più persone a schermo la soglia cresce con loro: tre colleghi che fanno 8
 * ore ciascuno non sono un'anomalia.
 */
export function dayFlag(hours: number, people = 1): "ok" | "oltre" | "impossibile" {
  const teste = Math.max(1, people);
  if (hours > 24 * teste) return "impossibile";
  if (hours > 8 * teste) return "oltre";
  return "ok";
}
