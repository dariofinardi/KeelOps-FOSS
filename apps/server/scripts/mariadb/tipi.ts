// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Che forma prendono i campi su MariaDB.**
 *
 * Su SQLite un testo è un testo: nessuna lunghezza, nessun limite. MySQL invece
 * vuole saperlo, e Prisma senza istruzioni sceglie `VARCHAR(191)` per ogni
 * `String` — che su questi dati non basta: la descrizione più lunga in
 * produzione è di **50.111 caratteri** (misurata il 01/09/2026), il testo
 * dell'indice 46.662, un messaggio 6.383. Senza annotazione la migrazione
 * passerebbe e i dati si troncherebbero, che è il modo peggiore di sbagliare.
 *
 * La regola con cui è compilato questo elenco:
 *
 * - **testo libero** (descrizioni, messaggi, note, payload JSON) → `Text`, e
 *   `LongText` dove già oggi si superano le decine di migliaia di caratteri;
 * - **nomi, titoli, indirizzi** → `VarChar` con una misura larga il doppio del
 *   massimo visto, così cinque anni di dati ci stanno senza pensarci più;
 * - tutto il resto resta il `VARCHAR(191)` di Prisma: identificativi (cuid),
 *   email, colori, enum scritti come stringa.
 *
 * **I campi indicizzati o unici NON possono diventare `Text`**: MySQL non
 * indicizza un testo senza prefisso. Quelli restano `VarChar`, dimensionati
 * sotto i 3072 byte che InnoDB concede a un indice (768 caratteri in utf8mb4).
 */
export const TIPI_MARIADB: Record<string, string> = {
  // — testo libero, lungo davvero
  "Task.description": "@db.LongText",
  "TaskIndex.text": "@db.LongText",
  "TaskIndex.summary": "@db.Text",
  "Comment.body": "@db.Text",
  "DealAnalysis.payload": "@db.LongText",
  "DealAnalysis.error": "@db.Text",
  "Project.description": "@db.Text",
  "RecurrenceTemplate.description": "@db.Text",
  "CrmNote.body": "@db.Text",
  "Company.notes": "@db.Text",
  "Task.participants": "@db.Text",
  "Task.lostReason": "@db.Text",
  "TimeEntry.note": "@db.Text",
  // — payload JSON: corti oggi, non c'è motivo di scommetterci
  "ActivityLog.payload": "@db.Text",
  "Notification.payload": "@db.Text",
  "AppSetting.value": "@db.Text",
  "User.projectOrder": "@db.Text",
  "User.columnOrder": "@db.Text",
  "User.calendarAliases": "@db.Text",
  // Le origini ammesse di un modulo iniettabile: una per riga, e un ospite
  // multi-tenant può averne parecchie. In VarChar(191) ci stanno sette
  // indirizzi scarsi, e l'ottavo sarebbe un errore in fase di salvataggio.
  "InjectClient.origins": "@db.Text",
  // La chiusura dell'email di conferma: fino a 600 caratteri.
  "InjectClient.mailClosing": "@db.Text",
  // La breve descrizione di una nota di rilascio del portale.
  "ProjectReleaseDocument.description": "@db.Text",
  // — titoli e nomi: larghi il doppio del massimo visto
  "Task.title": "@db.VarChar(500)",
  "RecurrenceTemplate.title": "@db.VarChar(500)",
  "Project.name": "@db.VarChar(255)",
  "Attachment.name": "@db.VarChar(500)",
  "Company.name": "@db.VarChar(255)",
  "ProjectReleaseDocument.title": "@db.VarChar(255)",
  // — indirizzi: un URL non sta in 191 caratteri, e questi sono anche unici
  "Attachment.url": "@db.VarChar(1000)",
  "Attachment.path": "@db.VarChar(768)",
  "PushSubscription.endpoint": "@db.VarChar(512)",
  "User.avatarUrl": "@db.VarChar(1000)",
  // — la regola di ricorrenza: una RRULE lunga ci sta comoda
  "RecurrenceTemplate.rrule": "@db.VarChar(500)",
};

/**
 * Le colonne misurate in produzione che superano i 191 caratteri: il
 * generatore pretende che ognuna abbia il suo tipo qui sopra, così una
 * dimenticanza si vede subito e non a dati troncati.
 */
export const OLTRE_IL_LIMITE = [
  "Task.description",
  "TaskIndex.text",
  "Comment.body",
  "DealAnalysis.payload",
  "PushSubscription.endpoint",
  "Notification.payload",
  "User.columnOrder",
  "ActivityLog.payload",
  "Task.title",
  "TaskIndex.summary",
];
