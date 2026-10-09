import { z } from "zod";
import { TicketPriority } from "../enums";

/**
 * **Il modulo «Richiedi assistenza» iniettato in un'applicazione ospite**
 * (11/09/2026).
 *
 * È una terza porta per aprire una richiesta, e va letta accanto alle altre
 * due: il dialogo interno (`createTicketSchema`) e l'API delle integrazioni
 * (`integrationCreateTicketSchema`, quella di osTicket, che resta **intatta**).
 * Perché una terza e non un parametro in più su quella di osTicket: là chi
 * chiama è un programma con un segreto, e dichiara `onBehalfOf` — un'email che
 * in KeelOps esiste. Qui chi chiama è **il browser di uno sconosciuto**: niente
 * segreti in pagina, nessun utente da citare, e l'unica difesa vera è l'origine
 * della chiamata.
 *
 * Di conseguenza qui non si nominano né progetto né utente: il progetto lo
 * decide il **tipo di richiesta** (la mappa sta sulla chiave, in `InjectClient`)
 * e l'autore è l'utente di servizio configurato. Chi ha scritto davvero si
 * racconta in `user` e `metadata`, che finiscono nel titolo e in coda al testo.
 */
export const injectUserSchema = z.object({
  /** L'unico campo indispensabile: è l'indirizzo a cui si risponde. */
  email: z.string().trim().email().max(200),
  /** Come si firma nell'applicazione ospite: va nel titolo, accanto all'email. */
  nickname: z.string().trim().max(120).optional(),
  name: z.string().trim().max(200).optional(),
  /** L'identificativo dell'utente **sull'applicazione ospite**, non da noi. */
  uuid: z.string().trim().max(120).optional(),
  /** Profilo/ruolo sull'applicazione ospite ("corporate", "admin", "user"). */
  profile: z.string().trim().max(120).optional(),
});
export type InjectUser = z.infer<typeof injectUserSchema>;

/**
 * I dati che lo sviluppatore dell'applicazione ospite decide di aggiungere:
 * tenant, piano, numero di licenze, id della sessione. Li raccoglie il suo
 * JavaScript e li allega alla richiesta, e noi non ne conosciamo i nomi.
 *
 * Chiavi e valori sono **testo e basta**, e sono pochi: questa roba finisce in
 * coda a un ticket che una persona legge — non è un canale per travasare un
 * database, e un limite basso lo dice meglio di un commento.
 */
export const injectMetadataSchema = z
  .record(z.string().trim().min(1).max(60), z.string().trim().max(500))
  .refine((value) => Object.keys(value).length <= 30, "Al massimo 30 metadati");

/** Dove si trovava l'utente quando ha chiesto aiuto: lo aggiunge il widget. */
export const injectContextSchema = z
  .object({
    url: z.string().trim().max(2000).optional(),
    locale: z.string().trim().max(35).optional(),
    app: z.string().trim().max(120).optional(),
    widget: z.string().trim().max(40).optional(),
    userAgent: z.string().trim().max(400).optional(),
  })
  .partial();

export const injectCreateRequestSchema = z.object({
  /** La chiave del tipo di richiesta ("tecnica", "commerciale"). */
  type: z.string().trim().min(1).max(60),
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(10).max(20000),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.MEDIUM),
  user: injectUserSchema,
  metadata: injectMetadataSchema.optional(),
  context: injectContextSchema.optional(),
});
export type InjectCreateRequestInput = z.infer<typeof injectCreateRequestSchema>;

/** Cosa risponde il server al widget: quanto basta a dire «è arrivata». */
export interface InjectCreateRequestResult {
  /** Riferimento leggibile da mostrare e da citare per email. */
  reference: string;
  /** Un gettone a uso singolo per allegare i file a QUESTA richiesta. */
  uploadToken: string;
  /** `false` se l'email di conferma non è partita (posta spenta o rifiutata). */
  confirmationSent: boolean;
}

/* ------------------------------------------------------------------ pannello */

/**
 * **La configurazione dei moduli, dalla pagina Sistema.**
 *
 * Gemella di quella delle chiavi API (`apiClientSchema`) ma con una differenza
 * che si vede a occhio: qui la chiave **si rilegge sempre**, perché è pubblica.
 * Là il segreto compare una volta sola e poi sparisce; qui sta nel sorgente di
 * una pagina che chiunque può aprire, e nasconderla darebbe solo l'idea
 * sbagliata di cosa protegge cosa.
 */
export const injectRequestTypeSchema = z.object({
  /** Chiave tecnica usata da `data-assistenza-open` ("tecnica"). */
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Solo minuscole, cifre e trattini: finisce in un attributo HTML"),
  label: z.string().trim().min(1).max(120),
  icon: z.enum(["wrench", "briefcase", "help"]).default("help"),
  projectId: z.string().min(1),
});

export const createInjectClientSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Una per riga o separate da virgola: il server le normalizza. */
  origins: z.string().trim().min(1).max(4000),
  serviceUserEmail: z.string().trim().email(),
  /** Crea l'utente di servizio se non esiste (senza password). */
  createServiceUser: z.boolean().default(false),
  replyTo: z.string().trim().email().or(z.literal("")).optional(),
  /**
   * Il nome del prodotto nell'email e nel ticket. Vuoto: il nome del progetto
   * del tipo di richiesta, e in mancanza quello del modulo (19/09/2026).
   */
  productName: z.string().trim().max(80).optional(),
  /** Un paragrafo in coda alla conferma, testo semplice. */
  mailClosing: z.string().trim().max(600).optional(),
  hourlyLimit: z.coerce.number().int().min(1).max(1000).optional(),
  types: z.array(injectRequestTypeSchema).min(1).max(10),
});
export type CreateInjectClientInput = z.infer<typeof createInjectClientSchema>;

/** Tutto facoltativo: si manda solo ciò che cambia. I tipi si sostituiscono in blocco. */
export const updateInjectClientSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  origins: z.string().trim().min(1).max(4000).optional(),
  replyTo: z.string().trim().email().or(z.literal("")).optional(),
  /**
   * Il nome del prodotto nell'email e nel ticket. Vuoto: il nome del progetto
   * del tipo di richiesta, e in mancanza quello del modulo (19/09/2026).
   */
  productName: z.string().trim().max(80).optional(),
  /** Un paragrafo in coda alla conferma, testo semplice. */
  mailClosing: z.string().trim().max(600).optional(),
  hourlyLimit: z.coerce.number().int().min(1).max(1000).optional(),
  types: z.array(injectRequestTypeSchema).min(1).max(10).optional(),
});
export type UpdateInjectClientInput = z.infer<typeof updateInjectClientSchema>;

/** Un modulo in elenco. */
export interface InjectClientDto {
  id: string;
  name: string;
  /** Pubblica: si mostra sempre per intero, è fatta per stare in una pagina. */
  publicKey: string;
  origins: string[];
  serviceUser: { id: string; email: string; name: string } | null;
  replyTo: string | null;
  productName: string | null;
  mailClosing: string | null;
  hourlyLimit: number;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  types: Array<{
    key: string;
    label: string;
    icon: string;
    projectId: string;
    projectName: string;
  }>;
}
