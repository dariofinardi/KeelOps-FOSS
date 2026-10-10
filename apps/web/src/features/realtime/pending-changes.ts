// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore } from "react";

/**
 * I record che il server dice cambiati e che noi **non abbiamo ancora
 * ricaricato**.
 *
 * Vivono fuori da React, in un contenitore piccolo e condiviso, perché li
 * scrive la connessione degli eventi (montata una volta sola) e li legge
 * l'avviso in fondo allo schermo. Nient'altro deve accorgersene: finché
 * l'utente non preme "Aggiorna" non si tocca una sola query.
 *
 * Regola di accumulo: **niente doppioni e niente rumore**. Se lo stesso record
 * cambia cinque volte mentre scrivo, resta una voce sola; l'avviso non
 * ricompare e non si anima, cresce solo il numero.
 */
export interface PendingRecord {
  id: string;
  kind: string;
}

let pending: PendingRecord[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function notePendingChanges(records: PendingRecord[]): void {
  const known = new Set(pending.map((record) => record.id));
  const fresh = records.filter((record) => !known.has(record.id));
  if (fresh.length === 0) return;
  pending = [...pending, ...fresh];
  emit();
}

export function clearPendingChanges(): void {
  if (pending.length === 0) return;
  pending = [];
  emit();
}

/** Solo per i test: riporta il contenitore allo stato iniziale. */
export function resetPendingChanges(): void {
  pending = [];
  listeners.clear();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePendingChanges(): PendingRecord[] {
  // `pending` cambia identità solo quando cambia davvero: getSnapshot può
  // restituirlo così com'è senza far girare React a vuoto.
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => pending,
  );
}
