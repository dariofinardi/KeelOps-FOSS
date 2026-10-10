// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { forbidden, notFound } from "../../lib/http-errors";
import type { User } from "../../generated/prisma/client";
import { evaluateTaskAccess, taskAccessContext } from "./permissions";

export interface TaskAccessInfo {
  /** Serve alla regola della menzione; facoltativo perché ogni task letto ce l'ha. */
  id?: string;
  kind: string;
  projectId: string | null;
  creatorId: string;
  /**
   * Stato del task: dice anche in quale AREA vive (TaskStatus.category), che
   * serve al manager d'area. È una colonna normale, quindi c'è in ogni oggetto
   * task già letto — nessuna include in più da ricordarsi.
   */
  statusId?: string | null;
  assigneeId?: string | null;
  supervisorId?: string | null;
  /** Offerte: esposta ai monitor vendite (vedi permissions.ts). */
  visibleToSalesMonitors?: boolean;
  /** Nato dall'area ticket: il richiedente lo vede anche senza il progetto. */
  createdViaTicket?: boolean;
}

/**
 * I due controlli che proteggono i task. La regola non è più scritta qui: sta in
 * `permissions.ts`, che la applica anche per dire al client quali comandi mostrare
 * — così il pulsante che si vede e la risposta del server non possono divergere.
 * Qui resta la traduzione del verdetto in errore HTTP.
 */

function deny(denial: { status: 403 | 404; message: string }): never {
  throw denial.status === 404 ? notFound(denial.message) : forbidden(denial.message);
}

/**
 * Visibilità: DEAL → modulo Offerte; PROJECT → membri; TICKET → autore (portale)
 * o utenti interni con scope TICKETS; ADMIN → gruppi ADMIN_TASKS. In tutte le aree
 * il coinvolgimento personale (assegnatario/supervisore/creatore) apre l'accesso.
 * Gli utenti PORTAL vedono esclusivamente i propri ticket.
 */
export async function assertTaskViewAccess(user: User, task: TaskAccessInfo): Promise<void> {
  const verdict = evaluateTaskAccess(await taskAccessContext(user), task);
  if (verdict.viewDenial) deny(verdict.viewDenial);
}

/**
 * Modifica: come la vista, ma nei progetti serve ruolo EDITOR o MANAGER e per le
 * offerte serve essere il proprietario (assegnatario/creatore) con accesso
 * completo — un utente in sola lettura può vedere ma non modificare.
 */
export async function assertTaskEditAccess(user: User, task: TaskAccessInfo): Promise<void> {
  const verdict = evaluateTaskAccess(await taskAccessContext(user), task);
  if (verdict.editDenial) deny(verdict.editDenial);
}
