// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { NotificationDto } from "@kancrm/shared";

/**
 * **Più notifiche sullo stesso task valgono per una.**
 *
 * Un task che si muove — passa di stato, riceve un messaggio, cambia
 * assegnatario — riempie l'elenco di righe che dicono la stessa storia, e
 * quella vecchia non serve più a nessuno: la si legge dall'ultima. Si mostra
 * quindi **solo la più recente**, dichiarando quante ne rappresenta, e
 * segnandola letta si leggono tutte insieme — altrimenti il contatore direbbe
 * cinque con tre righe davanti (24/08/2026).
 *
 * **Chi non parla di un task non si raggruppa**: il riepilogo scadenze e gli
 * avvisi di sistema non hanno un record dietro, e accorparli per tipo
 * nasconderebbe cose diverse sotto la stessa riga.
 */
export interface NotificationGroup {
  /** La più recente: è quella che si legge. */
  latest: NotificationDto;
  /** Tutte quelle che rappresenta, per segnarle lette in blocco. */
  ids: string[];
  /** Quante ne rappresenta (1 = notifica singola). */
  count: number;
  /** Quante di queste sono ancora da leggere. */
  unread: number;
}

const piuRecente = (a: NotificationDto, b: NotificationDto): NotificationDto =>
  a.createdAt >= b.createdAt ? a : b;

export function groupNotifications(notifications: NotificationDto[]): NotificationGroup[] {
  const perTask = new Map<string, NotificationGroup>();
  const gruppi: NotificationGroup[] = [];

  for (const notification of notifications) {
    const nuovo: NotificationGroup = {
      latest: notification,
      ids: [notification.id],
      count: 1,
      unread: notification.readAt === null ? 1 : 0,
    };
    if (!notification.taskId) {
      gruppi.push(nuovo);
      continue;
    }
    const esistente = perTask.get(notification.taskId);
    if (!esistente) {
      perTask.set(notification.taskId, nuovo);
      gruppi.push(nuovo);
      continue;
    }
    esistente.latest = piuRecente(esistente.latest, notification);
    esistente.ids.push(notification.id);
    esistente.count += 1;
    if (notification.readAt === null) esistente.unread += 1;
  }

  // Dalla più recente: un gruppo vale quanto la notizia che porta in cima.
  return gruppi.sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}
