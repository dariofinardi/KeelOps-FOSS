import { z } from "zod";
import { createTicketSchema } from "./tickets";
import { dateOnly, isWebUrl } from "./tasks";

/**
 * API per le integrazioni (12/08/2026): un account di servizio si autentica e
 * poi apre richieste **per conto di una persona vera**.
 *
 * Gli schemi stanno qui con tutti gli altri, e la creazione riusa quello del
 * ticket: l'API non è un secondo modo di descrivere un ticket — è la stessa
 * cosa, aperta da un'altra porta. Aggiungendo domani un campo alla richiesta,
 * l'integrazione lo riceve senza che nessuno se ne ricordi.
 */
export const integrationTokenSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type IntegrationTokenInput = z.infer<typeof integrationTokenSchema>;

/** Link da allegare alla richiesta (documento su Drive, pagina di un manuale…). */
export const integrationLinkSchema = z.object({
  name: z.string().min(1).max(200),
  /**
   * Solo http/https, con lo **stesso** refine dei link allegati a mano
   * (`isWebUrl`): `z.string().url()` da solo accetta `javascript:…` — per
   * `new URL()` è un indirizzo valido — e un link del genere, salvato oggi e
   * cliccato fra un mese da un collega, è uno script nel suo browser. Erano due
   * schemi per la stessa cosa e uno aveva perso la guardia (18/08/2026).
   */
  url: z.string().url().refine(isWebUrl, "Il link deve iniziare con http:// o https://"),
});

export const integrationCreateTicketSchema = createTicketSchema.extend({
  /**
   * Email dell'utente che sta aprendo la richiesta. Da qui in poi contano i
   * **suoi** permessi: l'account di servizio non ne aggiunge nessuno.
   */
  onBehalfOf: z.string().email(),
  /** Allegati per riferimento; i file si caricano dopo, sulla richiesta creata. */
  links: z.array(integrationLinkSchema).max(20).optional(),
});
export type IntegrationCreateTicketInput = z.infer<typeof integrationCreateTicketSchema>;

/**
 * Creazione di un task amministrativo dall'esterno (es. la scadenza "Fatture
 * da emettere" intestata a un cliente). Tipo di attività e azienda arrivano
 * **per nome** e si risolvono internamente: chi integra non conosce gli id.
 * Il referente (supervisore) è facoltativo — senza, vale il primo manager del
 * gruppo che governa l'area amministrativa; in mancanza anche di quello, chi
 * crea, che un task senza referente non ha nessuno che ne risponde.
 */
export const integrationCreateTaskSchema = z.object({
  /** Email dell'utente per conto del quale si crea: contano i SUOI permessi. */
  onBehalfOf: z.string().email(),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional(),
  /** Nome del tipo di attività, es. "Da fatturare". Facoltativo: un task può non averne. */
  activityType: z.string().trim().min(1).optional(),
  /**
   * Nome dello STATO in cui il task nasce, es. "Fatture da emettere" (che è
   * uno stato del flusso amministrativo, non un tipo: 31/08/2026). Senza, lo
   * stato iniziale della categoria.
   */
  status: z.string().trim().min(1).optional(),
  /** Nome dell'azienda cliente, es. "Acme". */
  company: z.string().trim().min(1),
  dueDate: dateOnly,
  /** Email del referente; senza, il manager del gruppo amministrativo. */
  supervisor: z.string().email().optional(),
});
export type IntegrationCreateTaskInput = z.infer<typeof integrationCreateTaskSchema>;

/** Emissione di una chiave API dalla pagina Sistema (solo amministratori). */
export const createApiClientSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateApiClientInput = z.infer<typeof createApiClientSchema>;

/** Una chiave in elenco: mai il segreto, solo la sua impronta leggibile. */
export const apiClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  clientId: z.string(),
  secretHint: z.string(),
  isActive: z.boolean(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiClientDto = z.infer<typeof apiClientSchema>;
