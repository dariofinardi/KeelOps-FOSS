import { z } from "zod";
import { TicketPriority } from "../enums";
import { taskStatusSchema } from "./task-statuses";
import { dateOnly, paginationSchema, taskDetailSchema, userRefSchema } from "./tasks";

export const ticketRequesterSchema = userRefSchema.extend({
  companyName: z.string().nullable(),
});

const projectRefSchema = z.object({ id: z.string(), name: z.string() });

export const ticketListItemSchema = z.object({
  id: z.string(),
  /** PROJECT per le richieste nuove (task di progetto), TICKET per le storiche. */
  kind: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  priority: z.nativeEnum(TicketPriority),
  ticketRef: z.string().nullable(),
  requester: ticketRequesterSchema,
  assignee: userRefSchema.nullable(),
  project: projectRefSchema.nullable(),
  commentCount: z.number().int(),
  /**
   * Ci sono messaggi di altri che chi guarda non ha ancora letto: è di chi
   * chiede l'elenco, non della richiesta (vedi tickets/letti.ts sul server).
   */
  hasUnread: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;

/** Dettaglio ticket: struttura del task (chat, allegati, attività) + campi ticket. */
export const ticketDetailSchema = taskDetailSchema.extend({
  priority: z.nativeEnum(TicketPriority),
  ticketRef: z.string().nullable(),
  requester: ticketRequesterSchema,
  /** Progetto collegato (impostato dal supporto interno). */
  project: projectRefSchema.nullable(),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).nullish(),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.MEDIUM),
  /** Riferimento esterno, es. numero del ticket osTicket di origine. */
  ticketRef: z.string().max(100).nullish(),
  /**
   * Progetto a cui la richiesta fa capo. **Obbligatorio** per chi scrive dal
   * portale: senza, una richiesta arriva senza sapere di quale commessa parla e
   * nessuno se ne fa carico. Dev'essere uno dei progetti autorizzati sull'utente
   * (vedi `ticketProjects` in Utenti); il manager di quel progetto ne diventa
   * il referente.
   */
  projectId: z.string().min(1, "Scegli il progetto a cui si riferisce la richiesta"),
  /** Scadenza desiderata, facoltativa. */
  dueDate: dateOnly.nullish(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/** Aggiornamento lato interno (il portale non può modificare i ticket). */
export const updateTicketSchema = z.object({
  statusId: z.string().optional(),
  assigneeId: z.string().nullish(),
  /**
   * La priorità **non è qui**: ha una rotta sua
   * (`PATCH /api/tickets/:id/priority`), l'unica che scrive la cronologia e
   * avvisa chi ci lavora, e l'unica aperta anche a **chi ha aperto la
   * richiesta** — da questa il cliente è escluso. Passandola qui si cambiava in
   * silenzio (17/08/2026).
   */
  ticketRef: z.string().max(100).nullish(),
  /** Progetto a cui collegare il ticket (dev'essere un progetto dell'utente). */
  relatedProjectId: z.string().nullish(),
});
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

/**
 * **Chi ha chiesto**: il richiedente di una richiesta si può correggere, ma
 * solo da amministratore elevato e da una rotta sua — come la priorità.
 * Cambiarlo sposta la richiesta: chi era il richiedente, se è un cliente del
 * portale, smette di vederla, e il nuovo comincia. Per questo non passa dalla
 * PATCH generale, dove sarebbe una chiave in mezzo alle altre (01/09/2026).
 */
export const updateTicketRequesterSchema = z.object({ requesterId: z.string().min(1) });
export type UpdateTicketRequesterInput = z.infer<typeof updateTicketRequesterSchema>;

/**
 * Criteri di ordinamento dell'elenco richieste.
 *
 * L'ordinamento è **del server**, non della pagina: l'elenco è impaginato, e
 * riordinare le cinquanta righe che si hanno sotto gli occhi darebbe una
 * classifica falsa (la prima per data non è la prima della pagina).
 *
 * La **priorità non è tra i criteri**, di proposito: in banca dati è la parola
 * `LOW|MEDIUM|HIGH`, e ordinarla alfabeticamente metterebbe *alta* in mezzo a
 * *bassa* e *media*. Per lavorare sulle urgenti c'è il **filtro** per priorità,
 * che dice la stessa cosa senza mentire sull'ordine.
 */
export const TICKET_SORT_BY = ["createdAt", "updatedAt", "title", "status"] as const;
export type TicketSortBy = (typeof TICKET_SORT_BY)[number];

/** Etichette e verso di partenza di ogni criterio (l'italiano è la chiave i18n). */
export const TICKET_SORT_OPTIONS: Array<{
  value: TicketSortBy;
  label: string;
  /** Verso naturale al primo clic: le date dalla più recente, i testi dalla A. */
  initialDir: "asc" | "desc";
}> = [
  { value: "title", label: "Titolo", initialDir: "asc" },
  { value: "createdAt", label: "Aperto il", initialDir: "desc" },
  { value: "updatedAt", label: "Aggiornato", initialDir: "desc" },
  { value: "status", label: "Stato", initialDir: "asc" },
];

export const ticketFiltersSchema = paginationSchema.extend({
  statusId: z.string().optional(),
  /** Filtro per priorità dichiarata da chi ha aperto (o ripesata dal supporto). */
  priority: z.nativeEnum(TicketPriority).optional(),
  /**
   * Progetto della richiesta. Vale per **entrambe le forme**: le richieste nuove
   * sono task di quel progetto (`projectId`), quelle storiche ci vengono
   * collegate dal supporto (`relatedProjectId`) — chi filtra non deve sapere di
   * questa differenza.
   */
  projectId: z.string().optional(),
  /**
   * Chi ha aperto la richiesta. Ha senso solo per chi vede anche quelle degli
   * altri — il desk: a chi vede le proprie il filtro direbbe sempre "io".
   */
  requesterId: z.string().optional(),
  q: z.string().optional(),
  includeClosed: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .optional(),
  sortBy: z.enum(TICKET_SORT_BY).default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type TicketFilters = z.infer<typeof ticketFiltersSchema>;

/**
 * Valori disponibili per i filtri dell'elenco richieste, col loro numero.
 *
 * Le tendine offrono **solo ciò che ha davvero delle richieste**: la lista dei
 * progetti dell'utente ne conteneva venti e diciotto davano un elenco vuoto —
 * scegliere un progetto senza ticket è un vicolo cieco con una spiegazione
 * mancante. Ogni facet si calcola **senza il proprio filtro** (altrimenti,
 * scelto un progetto, resterebbe solo quello in tendina) e la voce scelta resta
 * in elenco anche a zero, o la selezione si cancellerebbe da sé.
 */
export interface TicketFacets {
  /**
   * Gli stati che le richieste **hanno davvero**, col loro numero.
   *
   * Non si possono prendere dalla configurazione: una richiesta nata come task
   * di progetto vive negli stati di **sviluppo** ("In review", "Rilasciato"),
   * mentre la lista dei ticket storici è quella dei Generali. Offrendo i
   * Generali, il cliente con sessanta richieste di sviluppo vedeva una tendina
   * di stati che nessuna delle sue aveva (17/08/2026).
   */
  statuses: Array<{ id: string; name: string; color: string; count: number }>;
  projects: Array<{ id: string; name: string; count: number }>;
  requesters: Array<{ id: string; name: string; count: number }>;
}

/**
 * Quanto pesa una priorità, per poterle confrontare.
 *
 * In banca dati la priorità è la parola `LOW|MEDIUM|HIGH`, quindi "è salita" non
 * si legge dal valore: serve un ordine dichiarato. Sta qui perché lo usano il
 * server (per decidere se avvisare chi ci lavora) e il browser (per il verso
 * della frase), e due scale diverse direbbero due cose diverse.
 */
export const TICKET_PRIORITY_RANK: Record<TicketPriority, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

/**
 * La priorità è **salita**? Serve a distinguere l'avviso che cambia la giornata
 * ("ora è urgente") da quello che la libera. Una priorità mai scritta vale
 * media, come in tutta l'applicazione.
 */
export function isPriorityRise(
  from: TicketPriority | null | undefined,
  to: TicketPriority,
): boolean {
  const before = TICKET_PRIORITY_RANK[from ?? TicketPriority.MEDIUM];
  return TICKET_PRIORITY_RANK[to] > before;
}

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: "Bassa",
  MEDIUM: "Media",
  HIGH: "Alta",
};

/**
 * **Prendere in carico una richiesta**, anche **forzando** (25/09/2026): chi
 * lavora al desk può togliere la richiesta al collega che ce l'ha — dopo una
 * conferma, e il collega lo vede subito. Senza `forza` una richiesta presa
 * da altri resta un conflitto, come prima.
 */
export const presaInCaricoSchema = z.object({ forza: z.boolean().optional() }).default({});
export type PresaInCaricoInput = z.infer<typeof presaInCaricoSchema>;
