// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ProjectListItem } from "@kancrm/shared";

/**
 * Ordine **Automatico** della pagina Progetti: risponde a "da dove riprendo?".
 *
 * Tre fasce, dalla più urgente. Dentro l'ultima ci sono tre gradini, perché un
 * progetto senza scadenze mie non è per forza morto:
 *
 * 1. **Scadenza vicina** — un mio task aperto scade entro 15 giorni (o è già
 *    scaduto): per data, il più urgente in cima.
 * 2. **Ci sto lavorando** — l'ho toccato negli ultimi 30 giorni (modifica,
 *    commento, ore): per ultima lavorazione, il più recente in cima.
 * 3. **Il resto**, in questo ordine:
 *    3a. ho del lavoro mio, ma non urgente (scadenza oltre i 15 giorni o
 *        assente) — per data dell'ultimo task mio, dal più recente;
 *    3b. l'ho lavorato, ma più di 30 giorni fa — dal più recente;
 *    3c. progetti di altri — per data dell'ultimo task creato, dal più recente.
 *
 * Le soglie sono quelle chieste (15 e 30 giorni) e stanno qui, in chiaro: un
 * ordine "intelligente" che non si spiega sembra casuale, e la pagina infatti
 * scrive su ogni card perché sta lì.
 */
const URGENT_DAYS = 15;
const WORKING_DAYS = 30;

/** Giorni tra oggi e una data (negativi = passata). */
function daysFrom(today: string, date: string): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / day);
}

function withinDays(today: string, iso: string | null, days: number): boolean {
  if (!iso) return false;
  const elapsed = daysFrom(today, iso.slice(0, 10));
  return elapsed <= 0 && elapsed > -days;
}

/** 0, 1, 2… : più basso = più in alto nell'elenco (vedi il commento sopra). */
export type ProjectTier = 0 | 1 | 2 | 3 | 4;

export function projectTier(project: ProjectListItem, today: string): ProjectTier {
  if (project.myNextDueDate && daysFrom(today, project.myNextDueDate) <= URGENT_DAYS) return 0;
  if (withinDays(today, project.myLastActivityAt, WORKING_DAYS)) return 1;
  if (project.myOpenTaskCount > 0 || project.myNextDueDate || project.myLastAssignedAt) return 2;
  if (project.myLastActivityAt) return 3;
  return 4;
}

/** Data che ordina dentro la fascia; stringa vuota = nessuna (va in fondo). */
function tierDate(project: ProjectListItem, tier: ProjectTier): string {
  if (tier === 0) return project.myNextDueDate ?? "";
  if (tier === 1) return project.myLastActivityAt ?? "";
  if (tier === 2) return project.myLastAssignedAt ?? project.lastTaskCreatedAt ?? "";
  if (tier === 3) return project.myLastActivityAt ?? "";
  return project.lastTaskCreatedAt ?? "";
}

export function compareProjects(a: ProjectListItem, b: ProjectListItem, today: string): number {
  const tierA = projectTier(a, today);
  const tierB = projectTier(b, today);
  if (tierA !== tierB) return tierA - tierB;

  const byName = a.name.localeCompare(b.name);
  const dateA = tierDate(a, tierA);
  const dateB = tierDate(b, tierB);
  if (dateA === dateB) return byName;
  // Chi non ha data va in fondo alla propria fascia.
  if (!dateA) return 1;
  if (!dateB) return -1;
  // La prima fascia guarda avanti (scadenza più vicina), le altre indietro
  // (lavorato o creato più di recente).
  return tierA === 0 ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
}

/** Perché quel progetto sta lì: si mostra sulla card, così l'ordine è leggibile. */
export function tierLabel(tier: ProjectTier): string | null {
  return tier === 0
    ? "Hai una scadenza vicina"
    : tier === 1
      ? "Ci stai lavorando"
      : tier === 2
        ? "Hai del lavoro tuo"
        : tier === 3
          ? "Ci hai lavorato tempo fa"
          : null;
}

/** Applica l'ordine manuale salvato; i progetti non elencati seguono l'automatico. */
export function applyManualOrder(
  projects: ProjectListItem[],
  order: string[],
  today: string,
): ProjectListItem[] {
  const index = new Map(order.map((id, i) => [id, i]));
  return [...projects].sort((a, b) => {
    const ia = index.get(a.id) ?? Infinity;
    const ib = index.get(b.id) ?? Infinity;
    return ia !== ib ? ia - ib : compareProjects(a, b, today);
  });
}
