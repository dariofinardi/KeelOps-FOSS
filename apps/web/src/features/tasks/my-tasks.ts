// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Quando un task è "mio": me ne occupo come **assegnatario** o come **supervisore**.
 *
 * Serve in due punti che devono dire la stessa cosa — il segno sulle righe e il
 * filtro "solo i miei" — e serve soprattutto a chi vede un progetto per un altro
 * motivo (amministratore, o accesso di gruppo): senza distinzione, in mezzo a
 * quattrocento task non si trovano i propri.
 */
export interface TaskOwnership {
  assignee?: { id: string } | null;
  supervisor?: { id: string } | null;
}

export function isMyTask(task: TaskOwnership, userId: string): boolean {
  return task.assignee?.id === userId || task.supervisor?.id === userId;
}

/** Perché sto vedendo questo task: per ruolo mio, o perché vedo tutto il resto. */
export type TaskVisibilityReason = "assegnato" | "supervisore" | "altro";

export function visibilityReason(task: TaskOwnership, userId: string): TaskVisibilityReason {
  if (task.assignee?.id === userId) return "assegnato";
  if (task.supervisor?.id === userId) return "supervisore";
  return "altro";
}

export interface NestedTask extends TaskOwnership {
  id: string;
  parentTaskId?: string | null;
}

export interface MyTasksSelection<T> {
  /** Solo i miei, subtask compresi: è l'elenco da mostrare in piano. */
  mine: T[];
  /** Righe da mostrare mantenendo la gerarchia: i miei più i genitori. */
  visible: T[];
  /** Quanti sono davvero miei — il numero che va scritto sul filtro. */
  mineCount: number;
  /** Genitori presenti solo come contenitore: vanno aperti, o non si vedrebbe niente. */
  containers: Set<string>;
}

/**
 * Selezione "solo i miei" su un elenco a fisarmonica (task con subtask).
 *
 * Due trappole, entrambe viste dal vivo:
 *
 * 1. un **subtask mio dentro il task di un altro** sparirebbe, perché le righe
 *    si disegnano dai soli task di primo livello: il genitore va tenuto come
 *    contenitore, pur non essendo mio;
 * 2. il numero scritto sul filtro deve contare **i miei**, non le righe: un
 *    conteggio fatto su un insieme diverso da quello mostrato è come non averlo
 *    — diceva 85 mentre a schermo ce n'erano quattro.
 */
export function selectMyTasks<T extends NestedTask>(
  tasks: T[],
  userId: string,
): MyTasksSelection<T> {
  const mine = new Set(tasks.filter((task) => isMyTask(task, userId)).map((task) => task.id));
  const containers = new Set(
    tasks
      .filter((task) => task.parentTaskId && mine.has(task.id))
      .map((task) => task.parentTaskId!)
      // Un genitore già mio non è "solo contenitore": si conta e si mostra comunque.
      .filter((parentId) => !mine.has(parentId)),
  );
  return {
    mine: tasks.filter((task) => mine.has(task.id)),
    visible: tasks.filter((task) => mine.has(task.id) || containers.has(task.id)),
    mineCount: mine.size,
    containers,
  };
}
