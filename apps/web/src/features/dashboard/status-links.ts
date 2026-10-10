// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TaskKind } from "@kancrm/shared";

/**
 * Dove porta un badge di "I miei task per stato".
 *
 * I conteggi comprendono task di moduli diversi (scadenzario, progetti, ticket,
 * offerte) e ogni modulo ha il proprio elenco: filtrare uno stato di sviluppo
 * nello scadenzario darebbe una lista vuota. Il tipo prevalente del gruppo,
 * calcolato lato server, dice a quale elenco andare; dove esiste un filtro per
 * stato lo si passa in query string, insieme a `mine=1` (il badge parla dei
 * *miei* task, non di tutti quelli in quello stato).
 */
/** Nome del modulo che elenca quei task: distingue badge con lo stesso stato. */
export function statusModuleLabel(kind: string): string {
  switch (kind) {
    case TaskKind.PROJECT:
      return "progetti";
    case TaskKind.TICKET:
      return "ticket";
    case TaskKind.DEAL:
      return "offerte";
    default:
      return "scadenzario";
  }
}

export function statusListLink(status: { id: string; kind: string }): string {
  switch (status.kind) {
    case TaskKind.PROJECT:
      // I task di progetto vivono dentro il progetto: si arriva all'elenco
      // progetti, l'unico posto da cui raggiungerli.
      return "/progetti";
    case TaskKind.TICKET:
      return "/ticket";
    case TaskKind.DEAL:
      return "/offerte";
    default:
      return `/bacheche?statusId=${encodeURIComponent(status.id)}&mine=1`;
  }
}
