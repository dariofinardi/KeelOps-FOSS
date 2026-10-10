// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "I task su cui ho messo le mani per ultimo".
 *
 * L'ordine della tendina del timesheet. Alfabetico non serve a niente quando le
 * voci sono ottanta: chi apre quella tendina sta imputando le ore di **oggi**,
 * e le ore di oggi stanno quasi sempre su quello che ha toccato da poco.
 *
 * L'ultimo tocco è il più recente fra due cose, e servono entrambe:
 * - **`Task.updatedAt`** — il record è cambiato, anche per mano di un altro (se
 *   il collega ha spostato di stato un task mio, per me è tornato attuale);
 * - **la mia ultima riga nello storico** (`ActivityLog`) — perché scrivere un
 *   commento o allegare un documento *non* tocca la riga del task, ma è
 *   esattamente "metterci le mani". Senza questa metà, un task su cui ho
 *   discusso tutta la mattina resterebbe in fondo.
 */
export interface TouchableTask {
  id: string;
  updatedAt: Date;
}

function lastTouch(task: TouchableTask, mine: Date | null | undefined): number {
  const changed = task.updatedAt.getTime();
  const touched = mine ? mine.getTime() : 0;
  return Math.max(changed, touched);
}

/**
 * Dal più recente al più vecchio. A parità di istante decide l'id: un ordine
 * ballerino spezzerebbe le pagine — la tendina carica a blocchi, e un elemento
 * che cambia posto fra un blocco e l'altro comparirebbe due volte o mai.
 */
export function orderByLastTouch<T extends TouchableTask>(
  tasks: T[],
  myLastTouch: Map<string, Date | null>,
): T[] {
  return [...tasks].sort((a, b) => {
    const diff = lastTouch(b, myLastTouch.get(b.id)) - lastTouch(a, myLastTouch.get(a.id));
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}
