// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **L'ordine in cui si travasano le tabelle**: prima chi non dipende da
 * nessuno, poi chi ci si appoggia. Non è indispensabile — durante la copia i
 * controlli sulle chiavi esterne restano spenti, o `User.companyId` e
 * `Company.portalUsers` si aspetterebbero a vicenda per sempre — ma un ordine
 * sensato rende leggibile il resoconto e lascia il database coerente anche se
 * qualcosa si ferma a metà.
 *
 * L'elenco è esplicito di proposito, e un test pretende che copra **tutti** i
 * modelli dello schema: aggiungerne uno senza travasarlo vorrebbe dire
 * accorgersene a dati mancanti, mesi dopo.
 */
export const MODELLI_IN_ORDINE = [
  // anagrafiche e configurazione
  "company",
  "user",
  "group",
  "groupMember",
  "visibilitySetting",
  "contact",
  "project",
  "projectMember",
  "ticketProjectAccess",
  "taskStatus",
  "activityType",
  "dealStage",
  "board",
  "boardStatus",
  "tag",
  "appSetting",
  "apiClient",
  "injectClient",
  "injectRequestType",
  // il lavoro
  "recurrenceTemplate",
  "task",
  "taskTag",
  "comment",
  "activityLog",
  "timeEntry",
  "timesheetPin",
  "timesheetLock",
  "crmNote",
  "dealAnalysis",
  "taskIndex",
  // Chi sta gestendo una richiesta in questo momento: dura minuti, ma si travasa
  // come tutto il resto — l'elenco qui deve coprire lo schema, senza eccezioni.
  "ticketLock",
  // L'ultima apertura di una richiesta per persona (il segnalino «non letto»):
  // dipende da utente e task, entrambi già travasati.
  "ticketRead",
  // allegati e loro ponti
  "attachment",
  "taskAttachment",
  // Il legame fra un messaggio e i file arrivati con lui: sta qui e non accanto
  // ai commenti perché punta anche all'allegato, che nasce due righe sopra.
  "commentAttachment",
  "recurrenceTemplateAttachment",
  // Le note di rilascio in PDF di un progetto: progetto e allegato, già travasati.
  "projectReleaseDocument",
  "pendingInlineImage",
  // sessioni, avvisi, calendari
  "session",
  "authChallenge",
  "notification",
  "notificationPreference",
  "pushSubscription",
  "calendarFeed",
  // il registro delle assenze (06/09/2026): dipende solo da User
  "absence",
] as const;

export type Modello = (typeof MODELLI_IN_ORDINE)[number];
