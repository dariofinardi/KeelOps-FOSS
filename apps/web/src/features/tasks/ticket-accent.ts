// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TicketPriority, type TaskListItem } from "@kancrm/shared";

/**
 * Il segno di colore dei task **nati da un ticket**, per priorità: rosso alta,
 * arancione media, blu notte bassa (richiesta del 12/08/2026).
 *
 * Perché un colore e non l'ennesima etichetta: in una colonna kanban da trenta
 * card la provenienza dal ticket si legge già dal salvagente, ma *quanto è
 * urgente* no — e le richieste dei clienti sono le uniche che hanno una
 * priorità dichiarata da chi le ha aperte. Il bordo lo dice senza rubare una
 * riga di testo.
 *
 * Sta in un punto solo perché lo usano quattro viste (kanban, tabella e agenda
 * delle Bacheche, elenco dentro il progetto) e devono dire lo stesso colore:
 * tre mappe copiate sarebbero divergenti al primo ripensamento.
 */

export interface TicketAccent {
  /** Bordo intero, per le card del kanban. */
  border: string;
  /** Filo a sinistra, per le righe di elenco (un bordo intero su una riga urla). */
  left: string;
  /**
   * Pastiglia con l'etichetta della priorità, **nello stesso colore del bordo**:
   * chi riceve la richiesta legge a parole quello che nel kanban vede a colpo
   * d'occhio, e le due cose non possono dire tinte diverse (14/08/2026).
   */
  badge: string;
  /** Chiave da tradurre per il titolo (`title`), con la priorità già dentro. */
  titleKey: string;
}

/**
 * Le classi sono scritte per esteso: Tailwind legge il sorgente, e una stringa
 * composta a runtime (`border-${colore}-500`) non finirebbe nel foglio di
 * stile. Ogni tono ha la sua variante scura, altrimenti il blu notte sul tema
 * scuro sparisce nel fondo.
 */
const ACCENTS: Record<TicketPriority, TicketAccent> = {
  [TicketPriority.HIGH]: {
    border: "border-red-500/70 dark:border-red-400/60",
    left: "border-l-4 border-l-red-500/80 dark:border-l-red-400/70",
    badge: "bg-red-500/15 text-red-700 dark:text-red-300",
    titleKey: "Richiesta da ticket · priorità alta",
  },
  [TicketPriority.MEDIUM]: {
    border: "border-orange-400/80 dark:border-orange-400/60",
    left: "border-l-4 border-l-orange-400 dark:border-l-orange-400/70",
    badge: "bg-orange-400/20 text-orange-700 dark:text-orange-300",
    titleKey: "Richiesta da ticket · priorità media",
  },
  [TicketPriority.LOW]: {
    border: "border-blue-900/50 dark:border-blue-400/50",
    left: "border-l-4 border-l-blue-900/60 dark:border-l-blue-400/60",
    badge: "bg-blue-900/15 text-blue-900 dark:bg-blue-400/15 dark:text-blue-300",
    titleKey: "Richiesta da ticket · priorità bassa",
  },
};

/** Le classi della pastiglia per una priorità, senza passare da un task. */
export function priorityBadgeClass(priority: TicketPriority): string {
  return ACCENTS[priority].badge;
}

/**
 * Il segno del task, o `null` se non viene da un ticket. Una richiesta senza
 * priorità dichiarata vale come media: è il valore con cui nascono, e lasciarla
 * senza colore direbbe "non è un ticket", che è falso.
 */
export function ticketAccent(
  task: Pick<TaskListItem, "createdViaTicket" | "ticketPriority">,
): TicketAccent | null {
  if (!task.createdViaTicket) return null;
  return ACCENTS[task.ticketPriority ?? TicketPriority.MEDIUM];
}
