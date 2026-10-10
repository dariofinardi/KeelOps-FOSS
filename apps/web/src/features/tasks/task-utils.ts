// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { TaskListItem } from "@kancrm/shared";
import { localeTag } from "@/lib/i18n";

// I formatter dipendono dalla lingua (23/07 vs 07/23) ma NON dal fuso: la
// timezone aziendale resta Europe/Rome. Si costruiscono una volta per lingua e
// si riusano — cambiare lingua è raro, ricrearli a ogni data sarebbe uno spreco.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dateFmt(withTime: boolean, locale: string = localeTag()): Intl.DateTimeFormat {
  const key = `${withTime ? "dt" : "d"}:${locale}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      timeZone: "Europe/Rome",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
    fmtCache.set(key, f);
  }
  return f;
}

/**
 * Una data leggibile, da una **data** (`2026-08-14`) o da un **istante** ISO
 * (`2026-08-14T09:12:33.000Z`).
 *
 * Accetta entrambi perché nei DTO convivono: le scadenze sono date, la
 * creazione è un istante. Passandole un istante, la vecchia versione componeva
 * `2026-08-14T09:12:33.000ZT12:00:00Z` — una data non valida — e `Intl` non
 * risponde "—", **lancia**: la colonna "Creato" ha portato giù l'intera pagina
 * Bacheche appena rilasciata (14/08/2026). Da qui anche la rete di sicurezza: un
 * valore che non si sa leggere diventa un trattino, non una schermata bianca.
 *
 * Sulla data pura si usa mezzogiorno UTC per non slittare di un giorno; su un
 * istante si formatta il momento vero, nel fuso aziendale.
 */
export function formatDate(value: string): string {
  const date = value.length <= 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFmt(false).format(date);
}

/**
 * Scadenza leggibile: "23/07/2026" oppure "23/07/2026 · 15:00" se l'orario c'è.
 * Senza orario non si inventa un'ora: il task scade quel giorno, punto.
 */
export function formatDue(task: { dueDate: string | null; dueTime?: string | null }): string {
  if (!task.dueDate) return "—";
  const day = formatDate(task.dueDate);
  return task.dueTime ? `${day} · ${task.dueTime}` : day;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  // Stessa rete di sicurezza di formatDate: `Intl` su una data non valida lancia,
  // e una riga di elenco non deve poter far cadere la pagina che la contiene.
  return Number.isNaN(date.getTime()) ? "—" : dateFmt(true).format(date);
}

export function todayISO(): string {
  // Data odierna nella timezone aziendale (Europe/Rome).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

export type DueState = "overdue" | "today" | "future" | null;

export function dueState(task: Pick<TaskListItem, "dueDate" | "status">): DueState {
  if (!task.dueDate || task.status.isClosed) return null;
  const today = todayISO();
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  return "future";
}

export const dueStateClass: Record<Exclude<DueState, null>, string> = {
  overdue: "text-destructive font-medium",
  today: "text-amber-600 font-medium",
  future: "",
};
