// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/*
 * Which logged actions count as work on a task. Shared by the task picker of the
 * timesheet grid (core) and by the commercial helpers that propose rows and
 * hours from the same activity.
 */

/**
 * Azioni che sono **organizzazione, non lavoro**: creare un task, spostarne
 * l'assegnatario, correggere un titolo o una scadenza non sono ore da mettere a
 * timesheet. Lista condivisa con il pulsante "compila dalle attività", che deve
 * proporre le stesse righe di cui qui si stimano le ore.
 *
 * Da non confondere con la lista **per inclusione** dei promemoria
 * (`reminders.ts`): là si decide se disturbare una persona, e conviene essere
 * severi; qui si decide cosa proporre, e conviene essere generosi.
 */
export const BOOKKEEPING_ACTIONS = [
  "created",
  "assignee_changed",
  "supervisor_changed",
  "deleted",
  "restored",
  "billing_task_created",
  "project_created",
  "renamed",
  "due_changed",
  "activity_type_changed",
  "predecessor_changed",
  "company_changed",
  "moved",
];
