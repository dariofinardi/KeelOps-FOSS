// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TaskKind } from "./enums";

/**
 * La definizione ESPLICITA delle entità per kind: quali colonne di `Task`
 * vivono per quale vestito. Era implicita e sparsa (schemi zod per modulo,
 * `kind ===` nelle rotte, pannelli web): le regole scritte due volte divergono
 * al primo ritocco, quindi la mappa vive qui e basta.
 *
 * La struttura non è "un campo → un kind" ma GRUPPI di campi con l'insieme dei
 * kind che li usano, perché è così che stanno i dati (misurato in produzione
 * il 23/08/2026): il tipo di attività e i sottotask valgono per scadenzario E
 * progetti; i campi d'origine ticket seguono il task anche quando la
 * lavorazione entra in un progetto; `relatedProjectId` serve a offerte e
 * ticket.
 *
 * Il test a fianco tiene la mappa inchiodata a `schema.prisma`: ogni colonna
 * di Task deve appartenere a ESATTAMENTE un gruppo — una colonna nuova non
 * classificata fa fallire la build, e la mappa non può mentire.
 *
 * Solo descrizione, nessun comportamento: il codice esistente non cambia; il
 * codice nuovo (e l'esistente al primo ritocco) legge da qui.
 */

const ALL_KINDS = Object.values(TaskKind);

export interface TaskFieldGroup {
  /** I kind per cui questi campi hanno significato. */
  kinds: readonly TaskKind[];
  fields: readonly string[];
}

export const TASK_FIELD_GROUPS = {
  /** L'ossatura comune a ogni vestito — compreso il cliente del task
   *  (`companyId`), che la regola di precedenza ammette su qualunque kind. */
  core: {
    kinds: ALL_KINDS,
    fields: [
      "id", "kind", "title", "description", "statusId",
      "creatorId", "assigneeId", "supervisorId",
      "dueDate", "dueTime", "closedAt", "deletedAt", "archivedAt",
      "createdAt", "updatedAt", "companyId",
    ],
  },
  /**
   * **Da dove viene il task**, quando non è nato in KeelOps: il plugin che
   * l'ha creato passando da `ctx.tasks.create` e il suo riferimento
   * (22/09/2026). Vale per ogni kind — un plugin può generare lavoro di
   * qualunque natura — e serve a sapere, il giorno della disinstallazione,
   * cosa quel plugin ha lasciato nel core.
   */
  provenance: {
    kinds: ALL_KINDS,
    fields: ["pluginNick", "pluginRef"],
  },
  /** Il lavoro operativo (scadenzario e progetti): tipo di attività,
   *  sottotask e sequenze, riunioni, provenienza da un'offerta vinta. */
  operational: {
    kinds: [TaskKind.ADMIN, TaskKind.PROJECT],
    fields: [
      "activityTypeId", "parentTaskId", "predecessorId",
      "meetingId", "participants", "sourceDealId", "relatedDealId",
    ],
  },
  /** Le serie ricorrenti dello scadenzario: lo stampo e la data di occorrenza. */
  recurrence: {
    kinds: [TaskKind.ADMIN],
    fields: ["recurrenceTemplateId", "occurrenceDate"],
  },
  /** L'appartenenza a un progetto (i ticket usano `relatedProjectId`, non questa). */
  project: {
    kinds: [TaskKind.PROJECT],
    fields: ["projectId"],
  },
  /** Il vestito commerciale dell'offerta. */
  deal: {
    kinds: [TaskKind.DEAL],
    fields: [
      "dealStageId", "dealValue", "probability", "expectedCloseDate",
      "contactId", "lostReason", "visibleToSalesMonitors",
    ],
  },
  /** Il progetto DI RIFERIMENTO: l'offerta che ne prosegue uno, il ticket
   *  che lo riguarda. */
  projectReference: {
    kinds: [TaskKind.DEAL, TaskKind.TICKET],
    fields: ["relatedProjectId"],
  },
  /** L'origine ticket: resta sul task anche quando la lavorazione passa in un
   *  progetto (misurato: `ticketPriority` vive su TICKET e su PROJECT). */
  ticketOrigin: {
    kinds: [TaskKind.TICKET, TaskKind.PROJECT],
    fields: ["ticketPriority", "ticketRef", "createdViaTicket"],
  },
  /** Le bacheche personali: colonna propria, limite WIP. */
  board: {
    kinds: [TaskKind.PERSONAL],
    fields: ["boardId", "boardStatusId"],
  },
} as const satisfies Record<string, TaskFieldGroup>;

export type TaskFieldGroupName = keyof typeof TASK_FIELD_GROUPS;

/** Tutte le colonne di Task che questo modulo conosce (il test le confronta
 *  con lo schema: devono coincidere, senza buchi né invenzioni). */
export function allClassifiedTaskFields(): string[] {
  return Object.values(TASK_FIELD_GROUPS).flatMap((group) => [...group.fields]);
}

/** Le colonne che hanno significato per un kind. */
export function fieldsForKind(kind: TaskKind): string[] {
  return Object.values(TASK_FIELD_GROUPS)
    .filter((group) => (group.kinds as readonly TaskKind[]).includes(kind))
    .flatMap((group) => [...group.fields]);
}

/** I kind per cui una colonna ha significato ([] = colonna sconosciuta). */
export function kindsForField(field: string): TaskKind[] {
  const group = Object.values(TASK_FIELD_GROUPS).find((candidate) =>
    (candidate.fields as readonly string[]).includes(field),
  );
  return group ? [...group.kinds] : [];
}

/** Vero se la colonna ha significato per quel kind. */
export function isFieldForKind(field: string, kind: TaskKind): boolean {
  return kindsForField(field).includes(kind);
}
