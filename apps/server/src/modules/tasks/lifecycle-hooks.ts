// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Prisma, Task, User } from "../../generated/prisma/client";
import { moduliAttivi } from "../../edition/registry";

/**
 * **Gli agganci dei moduli dell'edizione nel ciclo di vita dei task**
 * (08/10/2026). Il nucleo crea, modifica, elimina, commenta e apre i task; i
 * moduli commerciali — oggi i ticket — ci aggiungono la loro parte (la presa in
 * carico, il segnalino «letto», gli avvisi al richiedente e al desk) senza che
 * il nucleo li conosca per nome. Ogni aggancio gira nel punto esatto in cui
 * prima stava il codice del modulo.
 */

/** Quello che un modulo fa su un commento, deciso una volta all'inizio. */
export interface AggancioCommento {
  /** Campi in più del commento, quando si sa se è scritto per il cliente. */
  campi?: (info: { perIlCliente: boolean }) => Partial<Prisma.CommentUncheckedCreateInput>;
  /** Chi segue la chat oltre ad assegnatario e supervisore. */
  seguaci?: readonly string[];
  /** Dopo le notifiche del nucleo (menzioni e commento). */
  dopo?: (info: {
    perIlCliente: boolean;
    /** Già avvisati con la menzione. */
    menzionati: readonly string[];
    /** Il testo salvato in chiaro (comandi tolti). */
    testo: string;
  }) => Promise<void>;
}

export interface AgganciTask {
  /** Il dettaglio di un task è stato aperto da chi lo può leggere. */
  dettaglioAperto?: (task: Task, user: User) => Promise<void>;
  /** Prima di qualunque modifica, dopo il controllo dei permessi: può rifiutare. */
  primaDiModificare?: (existing: Task, user: User) => Promise<void>;
  /** Dopo una modifica che ha cambiato lo stato. */
  dopoCambioStato?: (info: {
    existing: Task;
    user: User;
    statusChange: { from: string; to: string };
  }) => Promise<void>;
  /** Prima di eliminare, dopo il controllo dei permessi di modifica: può rifiutare. */
  primaDiEliminare?: (existing: Task, user: User) => Promise<void>;
  /**
   * Prima di allegare un file o un link: il modulo può decidere al posto del
   * nucleo (il cliente del portale allega alla propria richiesta, nei formati
   * ammessi). Null lascia decidere il nucleo; un rifiuto si lancia.
   */
  aggiuntaAllegato?: (
    task: Task,
    user: User,
  ) =>
    | { limitedToTicketFormats: boolean }
    | null
    | Promise<{ limitedToTicketFormats: boolean } | null>;
  /** I campi in più da copiare duplicando un task. */
  duplica?: (original: Task) => Partial<Prisma.TaskUncheckedCreateInput>;
  /**
   * Un commento sta per essere scritto (dopo il controllo di lettura). Può
   * rifiutare; altrimenti dice cosa fare dopo, o null se il task non lo riguarda.
   */
  commento?: (info: { task: Task; user: User; forza: boolean }) => Promise<AggancioCommento | null>;
}

let impostati: readonly AgganciTask[] | null = null;

/** Gli agganci dei moduli attivi (o di quelli dell'edizione configurata, fuori da `buildApp`). */
export function agganciTask(): readonly AgganciTask[] {
  return (impostati ??= moduliAttivi().flatMap((m) => (m.agganciTask ? [m.agganciTask] : [])));
}

export function impostaAgganciTask(agganci: readonly AgganciTask[]): void {
  impostati = agganci;
}
