// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { TaskDetail, UpdateTaskInput } from "@kancrm/shared";
import { createSnapshot } from "@/lib/snapshot";

/**
 * Il pannello di dettaglio salva ogni campo appena lo si modifica: comodo, ma senza
 * una via per tornare indietro se si è sbagliato. All'apertura si fotografa lo stato
 * del task; alla chiusura, se qualcosa è cambiato, si può ripristinare la fotografia.
 *
 * Sono coperti i campi modificabili dai controlli del pannello. Restano fuori le
 * azioni che non sono "campi" e hanno già una conferma propria: allegati, commenti e
 * lo spostamento di contesto (progetto/offerta).
 */
export interface TaskSnapshot {
  title: string;
  description: string | null;
  statusId: string;
  assigneeId: string | null;
  supervisorId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  activityTypeId: string | null;
  predecessorId: string | null;
  tagIds: string[];
}

const snapshotter = createSnapshot<TaskDetail, TaskSnapshot>({
  title: { label: "Titolo", read: (t) => t.title },
  description: { label: "Descrizione", read: (t) => t.description },
  statusId: { label: "Stato", read: (t) => t.status.id },
  assigneeId: { label: "Assegnatario", read: (t) => t.assignee?.id ?? null },
  supervisorId: { label: "Supervisore", read: (t) => t.supervisor?.id ?? null },
  dueDate: { label: "Scadenza", read: (t) => t.dueDate },
  dueTime: { label: "Ora", read: (t) => t.dueTime },
  activityTypeId: { label: "Tipo di attività", read: (t) => t.activityType?.id ?? null },
  predecessorId: { label: "Task propedeutico", read: (t) => t.predecessorId },
  tagIds: { label: "Tag", read: (t) => t.tags.map((tag) => tag.id).sort() },
});

export const snapshotOf = snapshotter.take;

/** Nomi dei campi modificati rispetto alla fotografia (vuoto = nessuna modifica). */
export const changedFieldLabels = snapshotter.changed;

/**
 * Payload che riporta il task alla fotografia. Le conferme sono incluse: è un
 * ripristino di uno stato già esistito, non una nuova decisione dell'utente, quindi
 * non deve inciampare negli avvisi su sequenza e subtask.
 */
export function restorePayload(snapshot: TaskSnapshot): UpdateTaskInput {
  return { ...snapshot, confirmSequence: true, confirmSubtasks: true };
}
