// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Note di rilascio: cosa è cambiato, build per build.
 *
 * **Sono in inglese e non si traducono**, di proposito: sono note tecniche
 * brevi, e tenerle in cinque lingue vorrebbe dire aggiornarne cinque a ogni
 * deploy — cioè non aggiornarle. Il titolo in pagina lo dichiara.
 *
 * **Ogni deploy aggiunge una voce in cima**, con il numero di build che il
 * deploy ha appena creato (lo stesso di `APP_VERSION`): due righe, dal punto di
 * vista di chi usa l'applicazione — cosa può fare oggi che ieri non poteva, o
 * cosa non si rompe più. Niente nomi di file, niente moduli: quelli stanno nei
 * messaggi di commit.
 *
 * **Le due edizioni** (08/10/2026): la numerazione è una sola, il codice è lo
 * stesso. Una voce che parla di una funzione commerciale (ticket, area
 * investitori, analisi delle offerte, modulo iniettabile, il timesheet completo…)
 * si scrive come `{ text, commerciale: true }`: la community non la mostra.
 * La community mostra solo le note da `PRIMA_VERSIONE_COMMUNITY` in poi — prima
 * c'era un prodotto solo, e la sua storia racconta funzioni che lì non ci sono.
 */

/** A release note line: plain text, or text that only the commercial edition shows. */
export type ReleaseNoteItem = string | { text: string; commerciale: true };

/** The first build released in two editions. */
export const PRIMA_VERSIONE_COMMUNITY = "0.12.68";

/** The text of a line, whatever its form. */
export const testoDellaVoce = (item: ReleaseNoteItem): string =>
  typeof item === "string" ? item : item.text;

export interface ReleaseNote {
  /** Numero di build, come in `APP_VERSION`. */
  version: string;
  /** Data del rilascio (YYYY-MM-DD): in pagina si legge nella lingua attiva. */
  date: string;
  /** Due o tre righe, in inglese, dal punto di vista di chi usa. */
  items: ReleaseNoteItem[];
}

/** Dalla più recente. */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.15.79",
    date: "2026-10-26",
    items: [
      "Security update: the libraries that handle file uploads, email, images, the database connection and the web server are on their fixed versions. Nothing changes in how you work; known weaknesses that could let a crafted upload or address slow the service down are closed.",
    ],
  },
  {
    version: "0.15.77",
    date: "2026-10-25",
    items: [
      "On the phone a deal shows one part at a time — Negotiation, Numbers, Content or Chat — chosen from the bar at the bottom, as a task already did: the fields no longer get squeezed into half the screen by the conversation.",
      "On the phone the history of a task or a deal can be read again, at the end of Content.",
    ],
  },
  {
    version: "0.15.75",
    date: "2026-10-21",
    items: [
      "Changing a task opened from a deal (or a subtask opened from its parent) shows the change at once in the panel below when you go back: title, due date, status, or the task gone if you deleted it.",
    ],
  },
  {
    version: "0.12.72",
    date: "2026-10-21",
    items: [
      "Wherever a link takes you — a task from a deal, a deal from a project, a project from a task, a customer's deals from its card — a “← back to …” button next to the title brings you back to exactly what you were looking at. A deal's tasks and a deal's next step now open on top of the deals page instead of leaving it.",
    ],
  },
  {
    version: "0.12.71",
    date: "2026-10-21",
    items: [
      "Linking a contact to a company that does not exist now says so, instead of failing with a generic error.",
    ],
  },
  {
    version: "0.12.70",
    date: "2026-10-17",
    items: [
      "Administrators can switch off, from the System page, the areas this installation does not use — deals, projects, contacts, hours, the technical trend — and each module of the edition. A switched-off area disappears for everyone, menu, pages and group permissions included; its data stays, and switching it back on brings it back as it was, with no restart.",
    ],
  },
  {
    version: "0.12.68",
    date: "2026-10-08",
    items: [
      "KeelOps now speaks Portuguese (Portugal): choose it in your profile — the interface, the emails and the plugins follow. The French, German and Spanish texts that were still showing in Italian are translated too.",
      "Timesheet summaries — by task, person or project, and projects by people — follow the month or week lens, like the calendar.",
      'In the dev area panel ("L\'andamento"), the people table has an Overdue column: the open tasks each person holds that are past their due date.',
    ],
  },
];
