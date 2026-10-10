// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "../../db";
import { noteForRequest, takeNotes } from "../../lib/request-context";
import { pushSse } from "../notifications/service";

/**
 * "Quel record che hai davanti è cambiato".
 *
 * È un avviso, non una notifica: non finisce nella campanella, non manda email,
 * non lascia traccia. Dice soltanto al browser di chi sta guardando che i dati a
 * schermo non sono più quelli veri — e nemmeno lo aggiorna: **decide l'utente**,
 * con il pulsante dell'avviso. Un elenco che si riordina da solo mentre si sta
 * leggendo, o peggio mentre si sta per cliccare, è un difetto, non una comodità.
 *
 * **A chi**: alle persone che quel record ce l'hanno in mano — assegnatario,
 * supervisore, chi l'ha creato — meno chi ha appena fatto la modifica, che il
 * suo schermo l'ha già aggiornato. Sono i tre campi del task, quindi nessuna
 * regola di visibilità nuova: chi è coinvolto lo vede per definizione
 * (`isPersonallyInvolved` in `tasks/permissions.ts`).
 *
 * **Quando**: a risposta conclusa. Dentro la transazione si annota soltanto
 * (`noteForRequest`): annunciare un cambiamento che poi rollbacca manderebbe
 * tutti a rileggere il dato vecchio.
 */
const NOTE_KEY = "record-changes";

export interface RecordChangeNote {
  taskId: string;
  actorId: string;
}

export interface RecordChangedEvent {
  kind: "record-changed";
  /** I record cambiati in questa richiesta, per chi riceve l'avviso. */
  records: Array<{ id: string; kind: string }>;
}

/** Annota un record toccato. La chiama `logActivity`: punto unico di passaggio. */
export function noteRecordChanged(taskId: string, actorId: string): void {
  noteForRequest<RecordChangeNote>(NOTE_KEY, { taskId, actorId });
}

/** Chi va avvisato di un record, escluso chi l'ha appena toccato. */
export function recipientsOf(
  task: { assigneeId: string | null; supervisorId: string | null; creatorId: string },
  actorId: string,
): string[] {
  return [...new Set([task.assigneeId, task.supervisorId, task.creatorId])].filter(
    (id): id is string => Boolean(id) && id !== actorId,
  );
}

/**
 * Spedisce gli avvisi annotati durante la richiesta. Un messaggio per persona,
 * con dentro tutti i record che la riguardano: una modifica che ne tocca tre
 * (un task e i suoi subtask) non deve far comparire tre avvisi.
 */
export async function flushRecordChanges(): Promise<void> {
  const notes = takeNotes<RecordChangeNote>(NOTE_KEY);
  if (notes.length === 0) return;

  const byTask = new Map<string, string>(); // taskId -> chi l'ha toccato
  for (const note of notes) byTask.set(note.taskId, note.actorId);

  const tasks = await prisma.task.findMany({
    where: { id: { in: [...byTask.keys()] } },
    select: { id: true, kind: true, assigneeId: true, supervisorId: true, creatorId: true },
  });

  const perUser = new Map<string, RecordChangedEvent["records"]>();
  for (const task of tasks) {
    for (const userId of recipientsOf(task, byTask.get(task.id) ?? "")) {
      const records = perUser.get(userId) ?? [];
      records.push({ id: task.id, kind: task.kind });
      perUser.set(userId, records);
    }
  }
  for (const [userId, records] of perUser) {
    pushSse(userId, { kind: "record-changed", records } satisfies RecordChangedEvent);
  }
}
