// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { TaskListItem } from "@kancrm/shared";

/**
 * A cosa fa capo un task, per chi lo legge in un elenco: l'offerta o il progetto
 * da cui nasce, e l'azienda cliente.
 *
 * Negli elenchi conta più "di chi è il lavoro" che "chi lo fa": il nome della
 * persona lo si sta già filtrando o lo si conosce, mentre senza il riferimento
 * un titolo come "Attività agosto" non dice per chi.
 */
export interface TaskReference {
  /** Offerta o progetto: nome da mostrare. */
  label: string | null;
  kind: "deal" | "project" | null;
  /** Azienda cliente, se il task ne ha una (propria o dell'offerta d'origine). */
  company: string | null;
}

export function taskReferenceOf(task: TaskListItem): TaskReference {
  // L'offerta ha la precedenza: è il riferimento più specifico quando c'è.
  if (task.relatedDeal) {
    return { label: task.relatedDeal.title, kind: "deal", company: task.company?.name ?? null };
  }
  const project = task.project ?? task.relatedProject;
  if (project) {
    return { label: project.name, kind: "project", company: task.company?.name ?? null };
  }
  return { label: null, kind: null, company: task.company?.name ?? null };
}

/** Vero se c'è qualcosa da mostrare: senza, la cella resta vuota. */
export function hasTaskReference(reference: TaskReference): boolean {
  return reference.label !== null || reference.company !== null;
}
