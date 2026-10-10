// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

/**
 * Come si presentano le email di notifica. Sono poche cose di proposito: il
 * template è uno solo e deve restare leggibile ovunque (i client di posta
 * ignorano metà del CSS), quindi si configura *cosa dice*, non *com'è fatto*.
 */
export const mailSettingsSchema = z.object({
  /**
   * Indirizzo pubblico dell'applicazione. È quello che rende cliccabili le
   * email: senza, il messaggio arriva ma senza collegamenti — un link che porta
   * al localhost del server sarebbe peggio della sua assenza.
   */
  baseUrl: z.string(),
  /** Riga di apertura sopra il testo della notifica (vuota = si salta). */
  intro: z.string(),
  /** Chiusura in fondo, sotto il pulsante (es. "Team KeelOps · interno"). */
  footer: z.string(),
  /** Mostra il logo aziendale in testa al messaggio (serve l'indirizzo pubblico). */
  showLogo: z.boolean(),
});
export type MailSettings = z.infer<typeof mailSettingsSchema>;

export const updateMailSettingsSchema = z.object({
  baseUrl: z.string().max(300).optional(),
  intro: z.string().max(500).optional(),
  footer: z.string().max(300).optional(),
  showLogo: z.boolean().optional(),
});
export type UpdateMailSettingsInput = z.infer<typeof updateMailSettingsSchema>;

/**
 * Stato della posta in uscita, per la pagina di configurazione: dice se e come
 * si spedisce **senza rivelare le credenziali** (host e utente bastano a capire
 * se si sta parlando col provider giusto; la password non esce mai).
 */
export const mailStatusSchema = z.object({
  /** true quando c'è un server a cui consegnare (MAILER_HOST configurato). */
  enabled: z.boolean(),
  /** "smtp" spedisce davvero, "log" scrive soltanto cosa sarebbe partito. */
  transport: z.string(),
  host: z.string(),
  from: z.string(),
});
export type MailStatus = z.infer<typeof mailStatusSchema>;

/**
 * Calendari sottoscrivibili: acceso o spento, e basta. Vive nella stessa pagina
 * della posta perché sono le due strade con cui KeelOps esce da sé stesso.
 */
export const calendarSettingsSchema = z.object({ feedsEnabled: z.boolean() });
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;
export const updateCalendarSettingsSchema = calendarSettingsSchema;

export const mailConfigSchema = z.object({
  settings: mailSettingsSchema,
  status: mailStatusSchema,
  /** Anteprima HTML del template con i valori attuali. */
  previewHtml: z.string(),
  calendar: calendarSettingsSchema,
});
export type MailConfig = z.infer<typeof mailConfigSchema>;

export const MAIL_SETTINGS_DEFAULTS: MailSettings = {
  baseUrl: "",
  intro: "",
  footer: "",
  showLogo: true,
};
