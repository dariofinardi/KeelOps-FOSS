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
    version: "0.12.68",
    date: "2026-10-08",
    items: [
      "KeelOps now speaks Portuguese (Portugal): choose it in your profile — the interface, the emails and the plugins follow. The French, German and Spanish texts that were still showing in Italian are translated too.",
      "Timesheet summaries — by task, person or project, and projects by people — follow the month or week lens, like the calendar.",
      'In the dev area panel ("L\'andamento"), the people table has an Overdue column: the open tasks each person holds that are past their due date.',
    ],
  },
];
