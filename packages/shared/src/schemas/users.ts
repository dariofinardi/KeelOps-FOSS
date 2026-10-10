// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { AuthProvider, UserRole } from "../enums";

export const groupRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type GroupRef = z.infer<typeof groupRefSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: z.nativeEnum(UserRole),
  authProvider: z.nativeEnum(AuthProvider),
  isActive: z.boolean(),
  /** Utente di sistema (Archivio): non accede, non si modifica, non si elimina. */
  isSystem: z.boolean(),
  /** Amministrativo a cui assegnare i task delle offerte vinte da questo utente. */
  billingAssignee: groupRefSchema.nullable(),
  /** Permesso solo-timesheet: vede i timesheet di tutti. */
  canViewAllTimesheets: z.boolean(),
  /** Monitor vendite (portale investitori) che vede tutte le offerte, non solo le contrassegnate. */
  salesMonitorAllDeals: z.boolean(),
  /** Ore settimanali da contratto: il denominatore dei riepiloghi di produttività. */
  weeklyHours: z.number().int(),
  /** Come è nominata sul calendario delle assenze, oltre al proprio nome. */
  calendarAliases: z.string().nullable(),
  createdAt: z.string(),
  /** Ultimo accesso riuscito (autenticazione). Null: non è mai entrato. */
  lastLoginAt: z.string().nullable(),
  /**
   * Ultima attività: si aggiorna usando l'applicazione, non solo entrando — la
   * sessione dura giorni, quindi "ha fatto l'accesso" e "lo sta usando" sono
   * due domande diverse.
   */
  lastSeenAt: z.string().nullable(),
  /** Password sbagliate di fila (accesso o cambio password); dal terzo scatta il freno. */
  failedPasswordAttempts: z.number().int(),
  /** Fino a quando l'accesso è chiuso dal freno; null = aperto. */
  lockedUntil: z.string().nullable(),
  groups: z.array(groupRefSchema),
  /**
   * Progetti su cui questa persona può **aprire richieste di supporto**: i
   * clienti del portale, e dal 12/08/2026 anche gli interni che non tengono il
   * desk (un commerciale che segnala il problema del suo cliente). L'elenco è
   * il permesso: vuoto = niente ticket.
   */
  ticketProjects: z.array(groupRefSchema),
  /**
   * Azienda di riferimento: ha senso **solo per i clienti del portale**, ed è
   * ciò che decide cosa vedono lì dentro — senza, il portale è una pagina
   * vuota. Viaggia come identificativo perché il selettore delle aziende
   * risolve il nome da sé.
   */
  companyId: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

/**
 * Dati collegati a un utente, mostrati prima di eliminarlo. Con `hasData` a true
 * l'eliminazione richiede un destinatario a cui trasferirli.
 */
export const userDeletionImpactSchema = z.object({
  hasData: z.boolean(),
  counts: z.object({
    /** Task dello scadenzario, di progetto e ticket (creati, assegnati o supervisionati). */
    tasks: z.number().int(),
    deals: z.number().int(),
    comments: z.number().int(),
    /** Ore a timesheet: passano all'utente Archivio, non al destinatario. */
    hours: z.number(),
    recurrences: z.number().int(),
    projects: z.number().int(),
    notes: z.number().int(),
    activities: z.number().int(),
  }),
});
export type UserDeletionImpact = z.infer<typeof userDeletionImpactSchema>;

/** Codice 409 restituito quando serve indicare il destinatario dei dati. */
export const TRANSFER_REQUIRED = "TRANSFER_REQUIRED";

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.nativeEnum(UserRole).default(UserRole.MEMBER),
  password: z.string().min(8).max(200),
  groupIds: z.array(z.string()).default([]),
  /** Azienda di appartenenza (solo per utenti PORTAL). */
  companyId: z.string().nullish(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
  companyId: z.string().nullish(),
  /** Amministrativo di riferimento per le offerte vinte da questo commerciale. */
  billingAssigneeId: z.string().nullish(),
  /** Permesso solo-timesheet: vede i timesheet di tutti. */
  canViewAllTimesheets: z.boolean().optional(),
  /** Monitor vendite: vede tutte le offerte, non solo quelle contrassegnate. */
  salesMonitorAllDeals: z.boolean().optional(),
  /**
   * Ore settimanali da contratto: il denominatore dei riepiloghi di
   * produttività. **Zero è ammesso** ed è il caso dei collaboratori che
   * dipendenti non sono: nessun monte ore da rispettare, quindi nessuna
   * copertura da calcolare — la riga mostra le ore fatte e basta.
   */
  weeklyHours: z.number().int().min(0).max(80).optional(),
  /**
   * Soprannomi usati sul calendario delle assenze («Manu», «Franci»), separati
   * da virgole. Nome e cognome si riconoscono da soli: qui si scrive solo
   * l'eccezione.
   */
  calendarAliases: z.string().max(200).nullish(),
  /**
   * Progetti su cui l'utente può aprire richieste di supporto: sostituisce
   * l'elenco corrente. Vale per i clienti del portale e per gli interni senza
   * desk; non per i monitor vendite, che guardano e basta.
   */
  ticketProjectIds: z.array(z.string()).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(8).max(200),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Esito del reset, per chi l'ha fatto. La password è **provvisoria** e va
 * consegnata: se l'email non è partita (posta non configurata, casella
 * rifiutata) chi ha premuto il pulsante deve saperlo subito e comunicarla in
 * un altro modo, altrimenti chiude la finestra convinto di aver finito e
 * l'altra persona resta fuori.
 */
export const resetPasswordResultSchema = z.object({
  /** L'email con le credenziali è stata consegnata al provider. */
  emailSent: z.boolean(),
  /** Indirizzo a cui è stata spedita (o a cui sarebbe stata spedita). */
  email: z.string(),
});
export type ResetPasswordResult = z.infer<typeof resetPasswordResultSchema>;
