// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { NotificationType, TaskKind } from "@kancrm/shared";

/** Quale pannello apre un riferimento: null se non rimanda a niente. */
export type RecordTarget = "task" | "deal" | "ticket" | null;

/**
 * Dove porta un riferimento a un record (id + tipo). Sta a parte dal pannello
 * che lo apre perché è la regola che serve verificare: una notifica su
 * un'offerta deve portare all'offerta, non a un task che non esiste.
 *
 * Il tipo arriva dal server come stringa libera (`Notification.taskKind`):
 * quello che non si riconosce si apre come task, che è il caso più comune e
 * l'unico che non perde niente per strada.
 */
export function recordTargetOf(
  taskId: string | null,
  kind?: string | null,
  /**
   * **Un cliente del portale ha un pannello solo**: la propria richiesta, in
   * sola lettura con la chat — «del progetto non deve vedere altro», dice la
   * regola, e l'elenco dei ticket la rispettava già. La campanella no: una
   * notifica su una richiesta nata come task di progetto gli apriva il pannello
   * INTERNO, con progetto, assegnatario, supervisore e storico (02/09/2026).
   *
   * Per lui non c'è niente da distinguere: tutto ciò che può vedere è un suo
   * ticket.
   */
  isPortal = false,
): RecordTarget {
  if (!taskId) return null;
  if (isPortal) return "ticket";
  if (kind === TaskKind.DEAL) return "deal";
  if (kind === TaskKind.TICKET) return "ticket";
  return "task";
}

/**
 * Dove porta una notifica cliccata: al record di cui parla, oppure — quando parla
 * di più task insieme — alla pagina che li elenca.
 *
 * Nessuna notifica deve restare cieca: il riepilogo scadenze ("3 in ritardo, 1 in
 * scadenza oggi") non ha un task solo da aprire, ma ha comunque un posto dove
 * quei task si vedono, ed è lì che deve portare.
 */
export type NotificationDestination =
  | { kind: "record"; taskId: string; target: Exclude<RecordTarget, null> }
  | { kind: "route"; path: string }
  | null;

export function notificationDestination(
  notification: {
    taskId: string | null;
    taskKind: string | null;
    type: string;
  },
  isPortal = false,
): NotificationDestination {
  const target = recordTargetOf(notification.taskId, notification.taskKind, isPortal);
  if (target && notification.taskId) {
    return { kind: "record", taskId: notification.taskId, target };
  }
  // Riepilogo scadenze: porta all'agenda, dove i task sono già raggruppati in
  // "in ritardo", "oggi", "domani" — le stesse parole della notifica.
  if (notification.type === NotificationType.DUE_DIGEST) {
    return { kind: "route", path: "/bacheche" };
  }
  return null;
}
