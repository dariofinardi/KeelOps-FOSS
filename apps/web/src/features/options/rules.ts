// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { ProjectRole, UserRole, VisibilityScope, type ProjectListItem } from "@kancrm/shared";
import type { ProjectMemberRef } from "@/features/tasks/UserSelect";

/**
 * Le regole delle tendine, in un posto solo.
 *
 * Ogni tendina dell'applicazione (stato, tipo di attività, persone, progetto)
 * dipende da due cose: **chi sei** e **dove sei** — lo scadenzario, le offerte,
 * un progetto, un ticket, una bacheca personale. Prima ogni pagina si scriveva
 * la propria versione di queste regole: i progetti erano filtrati in un modo nel
 * nuovo task e in un altro nel ticket, e le persone erano ristrette al perimetro
 * giusto solo nelle offerte. Da qui in poi la regola è una, e si cambia qui.
 *
 * Sono funzioni pure: le decisioni si possono verificare senza montare l'interfaccia.
 */

/** Il "dove sei": il modulo che si sta usando. */
export type OptionsModule = "ADMIN" | "DEAL" | "PROJECT" | "TICKET" | "BOARD";

export interface CurrentUserLike {
  id: string;
  role: string;
  canSeeAdminTasks: boolean;
  canEditDeals: boolean;
}

/** Il modulo corrisponde a un `TaskKind` (la bacheca personale usa task ADMIN). */
export function taskKindOf(module: OptionsModule): string {
  return module === "BOARD" ? "ADMIN" : module;
}

/**
 * Perimetro delle persone proponibili come intestatario.
 *
 * Si restringe **solo dove il server rifiuterebbe la scelta**: un'offerta va
 * intestata a chi ha accesso completo alle Offerte (`assertValidDealOwner`),
 * altrimenti la tendina proporrebbe nomi che danno errore al salvataggio.
 * Altrove resta aperta di proposito: chi riceve un task lo vede e lo lavora in
 * qualunque area, anche senza i permessi di quel modulo — è la regola
 * "il lavoro segue la persona".
 */
export function userScopeFor(module: OptionsModule): VisibilityScope | undefined {
  return module === "DEAL" ? VisibilityScope.DEALS : undefined;
}

/**
 * Si può intestare il lavoro a qualcun altro? In una bacheca **personale** no: è
 * roba propria, e un intestatario diverso la farebbe sparire da casa propria. In
 * una bacheca **condivisa** sì, è il suo scopo.
 */
export function canAssignOthers(
  context: { module: OptionsModule; sharedBoard?: boolean },
  user: CurrentUserLike,
): boolean {
  const { module } = context;
  if (module === "BOARD") return context.sharedBoard === true;
  if (module === "PROJECT" || module === "TICKET") return true;
  if (module === "DEAL") return user.canEditDeals;
  return user.canSeeAdminTasks || user.role === UserRole.ADMIN;
}

/**
 * Progetti in cui si può creare o spostare lavoro: da manager o editor, o da
 * admin. Restano fuori quelli in sola lettura, che il server rifiuterebbe, e
 * gli **archiviati**: archiviare vuol dire "qui non si lavora più", e un task
 * creato lì dentro non lo guarderebbe nessuno (11/08/2026).
 */
export function editableProjects(
  projects: ProjectListItem[] | undefined,
  user: CurrentUserLike,
): ProjectListItem[] {
  const isAdmin = user.role === UserRole.ADMIN;
  return (projects ?? []).filter(
    (p) =>
      !p.isArchived &&
      (isAdmin || p.myRole === ProjectRole.MANAGER || p.myRole === ProjectRole.EDITOR),
  );
}

/**
 * Chi lavora a un progetto, col ruolo: le tendine delle persone li mettono in
 * cima (vedi UserSelect). Vuoto — non `undefined` — quando non c'è progetto.
 */
export function projectMembersOf(
  projects: ProjectListItem[] | undefined,
  projectId: string | null | undefined,
): ProjectMemberRef[] | undefined {
  if (!projectId) return undefined;
  const project = (projects ?? []).find((p) => p.id === projectId);
  return project?.members.map((m) => ({ userId: m.user.id, role: m.role }));
}
