// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

// Base enums shared between server and web. Kept as const objects (not TS enums)
// so they stay erasable and usable as zod enums.

/**
 * Il vestito del task unico: la stessa riga di `Task` è scadenza, attività di
 * progetto, offerta, ticket o task personale a seconda del kind. I campi
 * specifici (dealValue per DEAL, ticketPriority per TICKET, …) vivono sulla
 * stessa tabella e li fa rispettare lo schema zod del modulo; la mappa
 * completa campi-per-kind è codice: `task-kind-fields.ts` qui accanto (col test
 * che la inchioda allo schema); la narrazione sta in manual/data-model.html.
 */
export const TaskKind = {
  /** Scadenzario amministrativo: il default; le ricorrenze nascono qui. */
  ADMIN: "ADMIN",
  /** Attività di progetto: ha un Project, un tipo di attività, le ore. */
  PROJECT: "PROJECT",
  /** Offerta in pipeline: fase, valore, probabilità, anagrafiche CRM. */
  DEAL: "DEAL",
  /** Ticket di assistenza: priorità, riferimento esterno, portale clienti. */
  TICKET: "TICKET",
  /** Task personale su bacheca privata: lo vede solo chi l'ha creato. */
  PERSONAL: "PERSONAL",
} as const;
export type TaskKind = (typeof TaskKind)[keyof typeof TaskKind];

export const UserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  /** Utente esterno (cliente): accesso limitato al solo modulo Ticket. */
  PORTAL: "PORTAL",
  /**
   * Utente esterno (monitor vendite): area riservata in sola lettura sulle offerte
   * contrassegnate "visibile ai monitor vendite". Non vede nient'altro.
   */
  SALES_MONITOR: "SALES_MONITOR",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/**
 * Ruoli **esterni**: entrano in un'area riservata e non lavorano dentro
 * l'applicazione. Non vanno mai proposti come assegnatari, supervisori,
 * commerciali o manager — il server rifiuterebbe la scelta.
 *
 * Sta qui, in un elenco solo, perché i controlli erano sparsi e nominavano
 * PORTAL uno per uno: aggiungendo un secondo ruolo esterno sarebbero rimasti
 * indietro a silenzio.
 */
export const EXTERNAL_ROLES: readonly UserRole[] = [UserRole.PORTAL, UserRole.SALES_MONITOR];

export function isExternalRole(role: string): boolean {
  return (EXTERNAL_ROLES as readonly string[]).includes(role);
}

export const TicketPriority = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

export const AuthProvider = {
  LOCAL: "LOCAL",
  GOOGLE: "GOOGLE",
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const ProjectRole = {
  MANAGER: "MANAGER",
  EDITOR: "EDITOR",
  VIEWER: "VIEWER",
} as const;
export type ProjectRole = (typeof ProjectRole)[keyof typeof ProjectRole];

export const AttachmentType = {
  FILE: "FILE",
  LINK: "LINK",
} as const;
export type AttachmentType = (typeof AttachmentType)[keyof typeof AttachmentType];

/** Categoria del tipo di attività di un task. */
export const ActivityCategory = {
  ADMIN: "ADMIN",
  SALES: "SALES",
  DEV: "DEV",
  /**
   * Controllo qualità: non conformità, azioni correttive, controlli
   * programmati. Aggiunta il 22/09/2026 per il plugin QABox, ma è un'area come
   * le altre e vale anche senza — chi non la usa non la configura e non la
   * vede comparire da nessuna parte.
   */
  QUALITY: "QUALITY",
  GENERAL: "GENERAL",
} as const;
export type ActivityCategory = (typeof ActivityCategory)[keyof typeof ActivityCategory];

/**
 * Come si leggono le categorie di attività. Sono **aree di lavoro**, e il nome lo
 * dice: prima si chiamavano "Amministrative / Commerciali / Sviluppo / Generali",
 * e quel "Generali" faceva pensare alle board Personali — che sono un'altra cosa.
 * `GENERAL` raccoglie i tipi validi **in ogni area** ("Riunione"), da cui il nome.
 * Gli identificatori interni non cambiano: cambia solo ciò che si legge.
 */
export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  GENERAL: "Tutte le aree",
  ADMIN: "Area amministrativa",
  SALES: "Area commerciale",
  DEV: "Area tecnica",
  QUALITY: "Area qualità",
};

/** Ordine di presentazione: "Tutte le aree" per prima, poi le aree vere. */
export const ACTIVITY_CATEGORY_ORDER: ActivityCategory[] = [
  ActivityCategory.GENERAL,
  ActivityCategory.ADMIN,
  ActivityCategory.SALES,
  ActivityCategory.DEV,
  ActivityCategory.QUALITY,
];

/** Cosa dice una riga del registro delle assenze. */
export const AbsenceKind = {
  /** Assenza: ferie, permesso, malattia… con le ore, o la giornata intera. */
  ABSENCE: "ABSENCE",
  /** Lavoro altrove (smart working, trasferta): vale come presenza. */
  PRESENCE: "PRESENCE",
  /** «C'ero»: spegne per quel giorno quello che dice il calendario. */
  NONE: "NONE",
} as const;
export type AbsenceKind = (typeof AbsenceKind)[keyof typeof AbsenceKind];

/** Da dove viene una riga del registro delle assenze. */
export const AbsenceSource = {
  /** Letta dal calendario aziendale (iCal), riallineata a ogni lettura. */
  CALENDAR: "CALENDAR",
  /** Scritta a mano: da sé, dal manager del gruppo o dal super admin. */
  MANUAL: "MANUAL",
} as const;
export type AbsenceSource = (typeof AbsenceSource)[keyof typeof AbsenceSource];
