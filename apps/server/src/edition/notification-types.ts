// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { NotificationType } from "@kancrm/shared";
import type { Prisma } from "../generated/prisma/client";
import { moduliAttivi, type ModuloEdizione } from "./registry";

/**
 * **I tipi di notifica dell'edizione** (08/10/2026). L'enum condiviso li elenca
 * tutti; il nucleo produce i suoi, i moduli dichiarano quelli che producono
 * (`tipiNotifica`). Una community avviata su un database commerciale trova
 * righe di tipi che nessuno qui sa spiegare — l'avviso di un ticket, il
 * promemoria del timesheet: non le cancella, non le mostra.
 */
export const TIPI_NOTIFICA_NUCLEO: readonly NotificationType[] = [
  NotificationType.TASK_ASSIGNED,
  NotificationType.MENTION,
  NotificationType.SUPERVISED_STATUS_CHANGED,
  NotificationType.TASK_COMMENT,
  NotificationType.DEAL_STAGE,
  NotificationType.DUE_DIGEST,
  NotificationType.PROJECT_MEMBER,
  NotificationType.BILLING_MILESTONE,
  NotificationType.USER_PENDING_APPROVAL,
  NotificationType.WIP_LIMIT,
];

/** I tipi che questa edizione sa produrre e spiegare. */
export function tipiNotificaPrevisti(
  moduli: readonly ModuloEdizione[] = moduliAttivi(),
): Set<NotificationType> {
  return new Set([...TIPI_NOTIFICA_NUCLEO, ...moduli.flatMap((m) => m.tipiNotifica ?? [])]);
}

/**
 * Il filtro da aggiungere a una lettura delle notifiche: i tipi dei moduli
 * assenti. Nell'edizione commerciale non ce ne sono, e il filtro è vuoto — la
 * query resta quella di sempre.
 */
export function senzaTipiAssenti(): Prisma.NotificationWhereInput {
  const previsti = tipiNotificaPrevisti();
  const assenti = Object.values(NotificationType).filter((tipo) => !previsti.has(tipo));
  return assenti.length > 0 ? { type: { notIn: assenti } } : {};
}
