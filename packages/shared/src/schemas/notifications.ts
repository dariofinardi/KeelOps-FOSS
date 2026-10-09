import { z } from "zod";

export const NotificationType = {
  TASK_ASSIGNED: "task_assigned",
  MENTION: "mention",
  SUPERVISED_STATUS_CHANGED: "supervised_status_changed",
  TASK_COMMENT: "task_comment",
  DEAL_STAGE: "deal_stage",
  DUE_DIGEST: "due_digest",
  TICKET_UPDATE: "ticket_update",
  /** Ingresso in un progetto: chi entra sa in che ruolo. */
  PROJECT_MEMBER: "project_member",
  /**
   * Attività amministrativa raggiunta: un task è entrato in uno stato marcato
   * come tappa da fatturare (consegna beta, collaudo…). Avvisa chi tiene
   * l'amministrazione, che deve emettere la fattura secondo l'offerta.
   */
  BILLING_MILESTONE: "billing_milestone",
  /**
   * Un nuovo accesso Google (dominio ammesso) ha creato un utente **inattivo**
   * in attesa: avvisa gli admin, che lo attivano dalla pagina Utenti.
   */
  USER_PENDING_APPROVAL: "user_pending_approval",
  /**
   * Timesheet da compilare: il venerdì pomeriggio, e di nuovo il lunedì se i
   * giorni scoperti sono ancora lì. Va a chi lavora in sviluppo, e **solo se
   * quella settimana ha davvero lavorato** su qualche record.
   */
  TIMESHEET_REMINDER: "timesheet_reminder",
  /**
   * Limite WIP superato: in un progetto ci sono più task aperti in uno stato di
   * quanti quello stato ne ammetta. Va ai **manager del progetto**, che possono
   * farci qualcosa; non blocca niente, e non torna a chi ha appena spostato il
   * task — quello il triangolo giallo sulla colonna glielo dice già.
   */
  WIP_LIMIT: "wip_limit",
  /**
   * La lettura degli allegati di un'offerta vinta è finita. Va a **chi l'ha
   * chiesta** — il commerciale che ha chiuso l'offerta — perché è l'unico che
   * sa se quello che il modello ha capito è giusto, e perché fra la richiesta e
   * la risposta passano minuti: senza avviso, la proposta resterebbe lì senza
   * che nessuno sappia che c'è.
   */
  DEAL_ANALYSIS: "deal_analysis",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const notificationSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(NotificationType),
  /** Testo già formattato lato server (italiano). */
  text: z.string(),
  /** Task/deal collegato, per aprire il dettaglio al click. */
  taskId: z.string().nullable(),
  taskKind: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

/**
 * **Due canali, due interruttori.** Per ogni tipo di evento si sceglie se
 * riceverlo nell'applicazione (campanella e notifica del browser) e se
 * riceverlo per email. Erano un interruttore solo, e chi voleva meno posta
 * doveva rinunciare anche all'avviso dentro il prodotto (04/09/2026).
 */
export const notificationPreferenceSchema = z.object({
  type: z.nativeEnum(NotificationType),
  /** Campanella, tempo reale e notifica del browser. */
  enabled: z.boolean(),
  /** Email. */
  email: z.boolean(),
});
export type NotificationPreferenceDto = z.infer<typeof notificationPreferenceSchema>;

/**
 * Si aggiorna **una casella alla volta**: il canale non nominato resta com'è.
 * Chiedere sempre entrambi vorrebbe dire che due schede aperte sulle preferenze
 * si sovrascrivono a vicenda l'interruttore che l'altra ha appena mosso.
 */
export const updateNotificationPreferenceSchema = z
  .object({
    type: z.nativeEnum(NotificationType),
    enabled: z.boolean().optional(),
    email: z.boolean().optional(),
  })
  .refine((input) => input.enabled !== undefined || input.email !== undefined, {
    message: "Indicare almeno un canale da aggiornare",
  });

/**
 * **Quali avvisi ha senso offrire a chi.**
 *
 * Il pannello mostrava a tutti tutti e tredici i tipi, compresi quelli che
 * riguardano solo chi lavora in azienda: un cliente del portale si trovava a
 * scegliere se ricevere il promemoria del timesheet, il limite WIP di un
 * progetto o l'attivazione di un utente Google — cose che non gli arriveranno
 * mai, e che gli fanno credere di avere sotto gli occhi un pannello di
 * qualcun altro (04/09/2026).
 *
 * Il cliente ne ha due, ed è tutto quello che lo raggiunge davvero: gli
 * aggiornamenti sulle sue richieste (cambi di stato e messaggi mandati con
 * `@user`) e le volte in cui qualcuno lo cita per nome.
 *
 * Sta qui e non nel server perché la stessa domanda la fa anche il browser,
 * quando decide cosa disegnare.
 */
export const PORTAL_NOTIFICATION_TYPES: readonly NotificationType[] = [
  NotificationType.TICKET_UPDATE,
  NotificationType.MENTION,
];

export function notificationTypesFor(role: string): NotificationType[] {
  return role === "PORTAL"
    ? [...PORTAL_NOTIFICATION_TYPES]
    : Object.values(NotificationType);
}

/**
 * Le preferenze di una persona: una riga per tipo (quelli che la riguardano) e
 * la scelta, valida per tutta la posta, di riceverla aggregata.
 */
export const notificationPreferencesSchema = z.object({
  items: z.array(notificationPreferenceSchema),
  /**
   * **Un riepilogo invece di un'email per avviso.** Riguarda solo la posta: la
   * campanella resta immediata.
   */
  emailDigest: z.boolean(),
  /** Le email anche di sabato e domenica; spento, aspettano il lunedì in un riepilogo. */
  emailWeekend: z.boolean(),
  /**
   * Ogni quanto parte il riepilogo, in minuti: lo decide la configurazione del
   * server, e viaggia fin qui perché la frase che lo spiega deve dire il numero
   * vero — non quello che il browser immagina.
   */
  emailDigestMinutes: z.number().int().positive(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateEmailDigestSchema = z
  .object({ emailDigest: z.boolean().optional(), emailWeekend: z.boolean().optional() })
  .refine((v) => v.emailDigest !== undefined || v.emailWeekend !== undefined, {
    message: "Niente da cambiare",
  });

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  task_assigned: "Task assegnato a me",
  mention: "Menzione in un commento",
  supervised_status_changed: "Cambio stato di un task che supervisiono",
  task_comment: "Commento su un mio task",
  deal_stage: "Offerta vinta / persa / da fatturare",
  due_digest: "Riepilogo scadenze (oggi / domani / in ritardo)",
  project_member: "Ingresso in un progetto",
  billing_milestone: "Attività amministrativa da fatturare",
  ticket_update: "Aggiornamenti sui ticket (stato, nuovi messaggi)",
  user_pending_approval: "Nuovo utente Google in attesa di attivazione",
  timesheet_reminder: "Timesheet da compilare (venerdì e lunedì)",
  wip_limit: "Troppi task aperti insieme in uno stato (limite WIP)",
  deal_analysis: "Lettura degli allegati di un'offerta vinta",
};
