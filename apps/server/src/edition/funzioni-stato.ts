// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Quali funzioni sono spente adesso**, in memoria (17/10/2026).
 *
 * È un file senza dipendenze di proposito: lo legge il registro dei moduli
 * (`moduliAttivi`) a ogni uso, e chi lo riempie (`funzioni.ts`) ha bisogno del
 * registro per conoscere il catalogo. Tenere lo stato qui spezza il cerchio.
 *
 * L'elenco è quello **in effetti**: le funzioni spente a mano più quelle che
 * dipendono da una spenta (`funzioniSpenteEffettive`).
 */
let spente: ReadonlySet<string> = new Set();
/** Gli scope di gruppo delle funzioni spente: con l'area spenta non valgono per nessuno. */
let scopeSpenti: ReadonlySet<string> = new Set();

/** La funzione `chiave` è accesa in questa installazione. */
export function funzioneAttiva(chiave: string): boolean {
  return !spente.has(chiave);
}

/** Le funzioni spente in effetti, in ordine alfabetico. */
export function funzioniSpenteOra(): string[] {
  return [...spente].sort();
}

/** Lo scope di gruppo vale: la funzione che lo porta (se c'è) è accesa. */
export function scopeAttivo(scope: string): boolean {
  return !scopeSpenti.has(scope);
}

/** Solo per `funzioni.ts` (e per i test): sostituisce l'elenco. */
export function impostaSpenteInMemoria(
  nuove: Iterable<string>,
  scope: Iterable<string> = [],
): void {
  spente = new Set(nuove);
  scopeSpenti = new Set(scope);
}
