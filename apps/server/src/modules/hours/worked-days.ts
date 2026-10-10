// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "../../db";
import { dayInRome } from "../../lib/date";

/*
 * Did a person work on something that day? The rule of the Friday timesheet
 * reminder and of the coverage in «L'andamento» — one rule, or the two would
 * contradict each other. Moved from timesheet/reminders.ts on 08/10/2026: it
 * reads the activity log and the chat, nothing commercial, and the panel is
 * core.
 */

/**
 * Cosa conta come "ho lavorato su un record".
 *
 * È una lista **per inclusione**, e non è la stessa del pulsante "compila dalle
 * attività" (che invece esclude — vedi BOOKKEEPING_ACTIONS in `routes.ts`): le
 * due rispondono a domande diverse. Là si chiede "quali task potrebbero meritare
 * delle ore", ed è meglio proporne uno in più; qui si chiede "questa persona ha
 * lavorato questo giorno", e sbagliare vuol dire disturbare chi era in ferie.
 * Non vanno unificate.
 */
const WORK_ACTIONS = [
  "status_changed",
  "stage_changed",
  "commented",
  "attachment_added",
  "updated",
];

/** Giorno di calendario (YYYY-MM-DD) di un istante, letto in Europe/Rome. */
export function dayOf(instant: Date): string {
  return dayInRome(instant);
}

/**
 * I giorni (YYYY-MM-DD) in cui la persona ha lavorato su qualche record
 * nell'intervallo, secondo `WORK_ACTIONS` più i messaggi in chat — che vivono
 * nella loro tabella e nel registro attività non ci sono quasi mai.
 */
export async function workedDays(userId: string, from: Date, toExclusive: Date): Promise<string[]> {
  const byUser = await workedDaysByUser([userId], from, toExclusive);
  return [...(byUser.get(userId) ?? [])].sort();
}

/**
 * Lo stesso, per più persone in due query invece che due a testa. Serve al
 * pannello dell'andamento, che misura la **copertura** del timesheet di tutta
 * la squadra: la regola di "ha lavorato" dev'essere una sola, o il promemoria
 * del venerdì e il numero in pagina finirebbero per contraddirsi.
 */
export async function workedDaysByUser(
  userIds: string[],
  from: Date,
  toExclusive: Date,
): Promise<Map<string, Set<string>>> {
  const [logs, comments] = await Promise.all([
    prisma.activityLog.findMany({
      where: {
        userId: { in: userIds },
        action: { in: WORK_ACTIONS },
        createdAt: { gte: from, lt: toExclusive },
      },
      select: { userId: true, createdAt: true },
    }),
    prisma.comment.findMany({
      where: { authorId: { in: userIds }, createdAt: { gte: from, lt: toExclusive } },
      select: { authorId: true, createdAt: true },
    }),
  ]);
  const byUser = new Map<string, Set<string>>();
  const add = (userId: string, when: Date) => {
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId)!.add(dayOf(when));
  };
  for (const row of logs) add(row.userId, row.createdAt);
  for (const row of comments) add(row.authorId, row.createdAt);
  return byUser;
}

