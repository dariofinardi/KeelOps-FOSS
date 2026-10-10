// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * Cosa va rinfrescato dopo aver toccato un task — e **task sono anche le offerte,
 * i ticket e le occorrenze ricorrenti**: stessa tabella, stesse API per commenti
 * e allegati.
 *
 * Prima ogni modulo aveva la propria versione di questo elenco: task, offerte e
 * ticket ne invalidavano insiemi diversi e parzialmente sovrapposti. Il difetto
 * non si vedeva nel codice ma a schermo — aggiungevi una vista, dimenticavi di
 * elencarla in uno dei tre, e per chi usa l'applicazione diventava "a volte non
 * si aggiorna". Ora l'elenco è uno: si aggiunge qui, e vale per tutti.
 *
 * Invalidare in eccesso non costa: TanStack Query rinfresca solo le query
 * effettivamente montate; le altre si limitano a scadere.
 */
export function invalidateTaskWorld(queryClient: QueryClient, id?: string): void {
  invalidateTaskLists(queryClient);
  if (id) invalidateTaskDetails(queryClient, id);
}

/** Solo gli elenchi e i riepiloghi: la parte che NON dipende dall'id. */
export function invalidateTaskLists(queryClient: QueryClient): void {
  // Elenchi: un task può comparire in tutti, secondo il suo tipo.
  for (const key of ["tasks", "deals", "tickets"]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
  // I conteggi dei tag cambiano quando un task li aggiunge o li toglie.
  void queryClient.invalidateQueries({ queryKey: ["tags"] });
  // Un'offerta vinta può far nascere un progetto, e i task di progetto ne
  // muovono la barra di avanzamento.
  void queryClient.invalidateQueries({ queryKey: ["projects"] });
  // La dashboard riassume task, board, offerte e ticket: senza, resta ferma
  // fino al refetch periodico.
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}

/** Solo i dettagli di UN record: il pannello aperto e la sua timeline. */
export function invalidateTaskDetails(queryClient: QueryClient, id: string): void {
  // Dettagli: lo stesso id può essere aperto come task, offerta o ticket.
  for (const key of ["task", "deal", "ticket"]) {
    void queryClient.invalidateQueries({ queryKey: [key, id] });
  }
  // Timeline lazy: quasi ogni modifica registra un'attività, e i commenti
  // cambiano con aggiunte ed eliminazioni.
  void queryClient.invalidateQueries({ queryKey: ["task-comments", id] });
  void queryClient.invalidateQueries({ queryKey: ["task-activities", id] });
}

/** La stessa cosa, pronta da usare dentro un componente. */
export function useInvalidateTaskWorld(): (id?: string) => void {
  const queryClient = useQueryClient();
  return (id?: string) => invalidateTaskWorld(queryClient, id);
}
