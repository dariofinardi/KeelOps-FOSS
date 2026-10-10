// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { ActivityCategory, AttachmentType, TaskKind, TicketPriority } from "../enums";
import { taskStatusSchema } from "./task-statuses";
import { activityTypeRefSchema } from "./activity-types";
import { tagRefSchema } from "./tags";

export const userRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type UserRef = z.infer<typeof userRefSchema>;

/** Data di scadenza in formato YYYY-MM-DD (timezone di visualizzazione Europe/Rome). */
/** Orario in formato "HH:MM" (24h), nella timezone aziendale. */
export const timeOnly = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Orario non valido (usa HH:MM)");

export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido");

export const taskListItemSchema = z.object({
  id: z.string(),
  kind: z.nativeEnum(TaskKind),
  title: z.string(),
  status: taskStatusSchema,
  assignee: userRefSchema.nullable(),
  supervisor: userRefSchema.nullable(),
  dueDate: dateOnly.nullable(),
  /** Orario della scadenza ("HH:MM", ora italiana); null = solo la data. */
  dueTime: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  attachmentCount: z.number().int(),
  commentCount: z.number().int(),
  predecessorId: z.string().nullable(),
  recurrenceTemplateId: z.string().nullable(),
  projectId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  /** Offerta collegata (task ADMIN dello scadenzario collegato a un deal). */
  relatedDeal: z.object({ id: z.string(), title: z.string() }).nullable(),
  /** Progetto di appartenenza (task di progetto). */
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  /**
   * Azienda cliente a cui il task fa capo: la propria (offerte), quella
   * dell'offerta collegata o dell'offerta che lo ha generato. Risolta dal server
   * perché la provenienza cambia da task a task, ma per chi legge è una sola cosa.
   */
  company: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Progetto di riferimento (ticket, o occorrenze di una ricorrenza a contratto). */
  relatedProject: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Nato dall'area ticket: si segnala negli elenchi (il cliente lo sta seguendo). */
  createdViaTicket: z.boolean(),
  /**
   * Priorità dichiarata da chi ha aperto la richiesta. Serve al colore del
   * bordo negli elenchi (12/08/2026): è l'unica urgenza che arriva da fuori.
   * Null sui task che non nascono da un ticket.
   */
  ticketPriority: z.nativeEnum(TicketPriority).nullable(),
  /** Tipo di attività (es. Emissione fattura, Telefonata, Fix). */
  activityType: activityTypeRefSchema.nullable(),
  /** Riunione in cui il task è nato (task di un tipo con isMeeting). */
  meeting: z.object({ id: z.string(), title: z.string(), dueDate: dateOnly.nullable() }).nullable(),
  /** Presenti, solo sui task-riunione: testo libero separato da virgole. */
  participants: z.string().nullable(),
  /** Etichette applicate al task. */
  tags: z.array(tagRefSchema),
  /**
   * Cosa può farci l'utente che sta guardando. Li calcola il **server**, con la
   * stessa regola che usa per accettare o rifiutare le richieste: così un comando
   * si vede se e solo se funziona. Prima ogni pagina se lo ricalcolava, e il menu
   * offriva "Elimina" anche a chi avrebbe ricevuto un rifiuto.
   */
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});
export type TaskListItem = z.infer<typeof taskListItemSchema>;

/** Riferimento a un task della stessa sequenza. */
export const sequenceRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  isClosed: z.boolean(),
});
export type SequenceRef = z.infer<typeof sequenceRefSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(AttachmentType),
  name: z.string(),
  url: z.string().nullable(),
  mimeType: z.string().nullable(),
  size: z.number().int().nullable(),
  createdAt: z.string(),
  uploadedBy: userRefSchema,
  /**
   * **Il messaggio con cui è arrivato**, se è arrivato da lì.
   *
   * Cambia due cose in pagina: si può saltare alla frase che lo accompagnava, e
   * l'allegato **non si toglie da qui** — se ne va con il messaggio, e a
   * cancellare il messaggio è solo chi l'ha scritto (o un amministratore).
   * Toglierlo di sotto lascerebbe in chat una frase che parla di un documento
   * che non c'è più.
   */
  commentId: z.string().nullable().default(null),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/**
 * Come aprire un allegato. **Unico punto** da cui passano sia il download di un
 * file sia l'apertura di un link: il client non usa mai l'URL grezzo, chiede al
 * server dove andare. È qui che si innesteranno le integrazioni future (Google
 * Workspace, un visualizzatore o un editor di documenti) senza toccare le pagine
 * che mostrano gli allegati — basterà aggiungere un `mode`.
 *
 * - `download`: URL firmato a vita breve verso lo streaming del file;
 * - `external`: indirizzo esterno da aprire in una scheda nuova;
 * - `viewer`: si legge dentro l'applicazione, senza salvarlo (monitor vendite);
 * - `drive-preview`: link Google Workspace letto nello stesso pannello del
 *   lettore, con l'anteprima incorporabile `/preview` di Google. L'occhio apre
 *   qui; la freccia continua a portare all'editor Google completo.
 * - `task`: link a un task di questa istanza (06/10/2026): si apre nel pannello
 *   del task, sopra il record da cui si viene; `taskId` dice quale.
 */
export const attachmentTargetSchema = z.object({
  mode: z.enum(["download", "external", "viewer", "drive-preview", "task"]),
  taskId: z.string().optional(),
  /** Il tipo del task di `taskId`: un ticket ha il suo pannello. */
  taskKind: z.string().optional(),
  url: z.string(),
  name: z.string(),
  mimeType: z.string().nullable(),
});
export type AttachmentTarget = z.infer<typeof attachmentTargetSchema>;

/**
 * Formati che il lettore interno sa mostrare. Quello che non è in elenco non si
 * apre: meglio dirlo, che offrire un riquadro vuoto.
 */
/**
 * **Il linguaggio di un file di codice, dall'estensione.**
 *
 * Dall'estensione e non dal contenuto: indovinare il linguaggio leggendo il
 * testo sbaglia proprio sui file corti, che sono quelli che si allegano a una
 * segnalazione. Un'estensione sconosciuta non è un errore — si mostra il testo
 * senza colori, che è comunque meglio di un download.
 */
export const CODE_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  py: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  sql: "sql",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  env: "ini",
  dockerfile: "dockerfile",
  makefile: "makefile",
  diff: "diff",
  patch: "diff",
  log: "accesslog",
};

export function codeLanguage(name: string): string | null {
  const lower = name.toLowerCase();
  // File senza estensione ma con un nome che è già il linguaggio.
  if (lower === "dockerfile" || lower === "makefile") return CODE_LANGUAGES[lower]!;
  return CODE_LANGUAGES[lower.split(".").pop() ?? ""] ?? null;
}

export function viewableKind(
  mimeType: string | null,
  name: string,
): "pdf" | "docx" | "image" | "video" | "audio" | "sheet" | "markdown" | "text" | "code" | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const type = (mimeType ?? "").toLowerCase();
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type.includes("wordprocessingml") || ext === "docx") return "docx";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext)) {
    return "image";
  }
  // Video e audio si guardano e si ascoltano **qui dentro** (18/08/2026): una
  // registrazione dello schermo scaricata per essere aperta con un altro
  // programma è una segnalazione che nessuno guarda. Si controlla anche
  // l'estensione perché il tipo dichiarato dal browser su `.mov` e `.mkv` è
  // spesso vuoto o generico.
  if (type.startsWith("video/") || ["mp4", "m4v", "mov", "webm", "mkv"].includes(ext)) {
    return "video";
  }
  if (type.startsWith("audio/") || ["mp3", "m4a", "wav", "ogg", "oga"].includes(ext)) {
    return "audio";
  }
  // I fogli di calcolo: solo il formato moderno (`xlsx`). Il vecchio `.xls`
  // binario vorrebbe un secondo lettore per pochi file, e resta scaricabile.
  if (type.includes("spreadsheetml") || ext === "xlsx") return "sheet";
  if (ext === "md" || ext === "markdown") return "markdown";
  // Il codice **prima** del testo: un `.json` è entrambe le cose, e con i colori
  // si legge meglio. L'estensione decide (vedi `codeLanguage`).
  if (codeLanguage(name)) return "code";
  if (type.startsWith("text/") || ["txt", "text", "csv", "tsv"].includes(ext)) return "text";
  return null;
}

export const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  /** Messaggio riservato (@secret): il corpo arriva vuoto, si sblocca riautenticandosi. */
  secret: z.boolean().default(false),
  /**
   * Riservato agli interni (`@reserved`): in chiaro, ma ai clienti del portale
   * e ai monitor vendite il server non lo manda affatto. Chi lo riceve è un
   * interno, e la marcatura gli ricorda che il cliente non lo vede.
   */
  reserved: z.boolean().default(false),
  /**
   * Mandato al cliente che ha aperto la richiesta (`@user`): gli è arrivata la
   * notifica, e con quella l'email. Il comando sparisce dal testo — è per noi,
   * non per chi legge — quindi è questo campo, e solo questo, a dire dopo se al
   * cliente è stato scritto.
   */
  sentToClient: z.boolean().default(false),
  createdAt: z.string(),
  author: userRefSchema,
  /** Incontro in cui è stata presa la nota: è la cella della matrice attività × riunioni. */
  meeting: z.object({ id: z.string(), title: z.string(), dueDate: dateOnly.nullable() }).nullable(),
  /**
   * I file arrivati **con** questo messaggio. Sono allegati del task come tutti
   * gli altri — si ritrovano nella sezione Allegati — e qui si vedono accanto
   * alla frase che li accompagnava, che è il modo in cui uno se li ricorda.
   */
  attachments: z.array(attachmentSchema).default([]),
});
export type Comment = z.infer<typeof commentSchema>;

export const activitySchema = z.object({
  id: z.string(),
  action: z.string(),
  payload: z.unknown().nullable(),
  createdAt: z.string(),
  user: userRefSchema,
});
export type Activity = z.infer<typeof activitySchema>;

/**
 * Pagina di commenti/attività caricata in modo lazy (endpoint dedicati, non più
 * nel dettaglio task). `nextCursor` è l'id da cui proseguire a ritroso (voci più
 * vecchie); null quando non c'è altro da caricare.
 */
export const commentPageSchema = z.object({
  items: z.array(commentSchema),
  nextCursor: z.string().nullable(),
});
export type CommentPage = z.infer<typeof commentPageSchema>;

/**
 * Sblocco di un messaggio riservato: la propria password, oppure un codice
 * usa-e-getta via email (prima lo si chiede, poi lo si presenta). Chi entra
 * solo con Google non ha password: per lui vale il codice — la casella È la
 * sua identità Google.
 */
export const unlockSecretCommentSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: z.string().min(1) }),
  z.object({ method: z.literal("otp-request") }),
  z.object({ method: z.literal("otp"), code: z.string().regex(/^\d{6}$/) }),
]);
export type UnlockSecretCommentInput = z.infer<typeof unlockSecretCommentSchema>;

export const activityPageSchema = z.object({
  items: z.array(activitySchema),
  nextCursor: z.string().nullable(),
});
export type ActivityPage = z.infer<typeof activityPageSchema>;

export const taskDetailSchema = taskListItemSchema.extend({
  /**
   * Aperto da un **cliente del portale**, non da un collega.
   *
   * L'area ticket la usano anche gli interni — un commerciale che segnala il
   * problema del suo cliente (12/08/2026) — e quelle richieste non hanno
   * nessuno «fuori» a cui scrivere: `@user`, che manda il messaggio al cliente
   * per email, lì non ha destinatario e non deve nemmeno comparire
   * (02/09/2026). Da qui la domanda ha una risposta sola, e la dà il server.
   */
  openedByClient: z.boolean(),
  description: z.string().nullable(),
  creator: userRefSchema,
  attachments: z.array(attachmentSchema),
  predecessor: sequenceRefSchema.nullable(),
  successors: z.array(sequenceRefSchema),
  /** Task padre (se questo è un subtask) e i subtask di questo task. */
  parent: sequenceRefSchema.nullable(),
  subtasks: z.array(sequenceRefSchema),
  /**
   * Solo nella risposta al completamento di un'occorrenza ricorrente: data della
   * scadenza successiva, appena creata o già presente (YYYY-MM-DD). null se la
   * ricorrenza è esaurita, assente in tutte le altre risposte.
   */
  nextOccurrenceDate: z.string().nullable().optional(),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).nullish(),
  statusId: z.string().optional(),
  assigneeId: z.string().nullish(),
  supervisorId: z.string().nullish(),
  dueDate: dateOnly.nullish(),
  /** Orario "HH:MM" (ora italiana); senza data viene ignorato. */
  dueTime: timeOnly.nullish(),
  /** Id dei tag da applicare (sostituiscono l'insieme corrente). */
  tagIds: z.array(z.string()).optional(),
  predecessorId: z.string().nullish(),
  projectId: z.string().nullish(),
  parentTaskId: z.string().nullish(),
  /** Offerta a cui collegare il task (solo task ADMIN, esclude projectId). */
  relatedDealId: z.string().nullish(),
  /** Tipo di attività (facoltativo). */
  activityTypeId: z.string().nullish(),
  /** Riunione in cui il task è stato deciso. */
  meetingId: z.string().nullish(),
  /** Presenti (solo sui task-riunione). */
  participants: z.string().max(500).nullish(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).nullish(),
  statusId: z.string().optional(),
  assigneeId: z.string().nullish(),
  supervisorId: z.string().nullish(),
  dueDate: dateOnly.nullish(),
  /** Orario "HH:MM" (ora italiana); senza data viene ignorato. */
  dueTime: timeOnly.nullish(),
  /** Id dei tag da applicare (sostituiscono l'insieme corrente). */
  tagIds: z.array(z.string()).optional(),
  predecessorId: z.string().nullish(),
  activityTypeId: z.string().nullish(),
  meetingId: z.string().nullish(),
  participants: z.string().max(500).nullish(),
  /**
   * Spostamento di contesto (solo task normali dello scadenzario o di progetto).
   * `projectId` porta il task dentro/fuori un progetto — cambia chi lo vede;
   * `relatedDealId` è solo un collegamento all'offerta e non cambia la visibilità.
   * I due sono esclusivi.
   */
  projectId: z.string().nullish(),
  relatedDealId: z.string().nullish(),
  /**
   * Azienda cliente a cui il task fa capo, senza passare da un'offerta (es. una
   * scadenza amministrativa di un cliente senza trattativa aperta). Sulle
   * offerte non si usa: lì il cliente si cambia dal pannello dell'offerta.
   */
  companyId: z.string().nullish(),
  /** Conferma esplicita per procedere con un task propedeutico non completato. */
  confirmSequence: z.boolean().optional(),
  /** Conferma esplicita per chiudere un task padre con subtask ancora aperti. */
  confirmSubtasks: z.boolean().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** Codice errore restituito (409) quando la sequenza richiede conferma. */
export const SEQUENCE_INCOMPLETE = "SEQUENCE_INCOMPLETE";

/** Parametri comuni di paginazione (query string → coerce). */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
});

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Lista task: include i valori disponibili per i filtri, così le tendine
 * propongono solo stati, assegnatari e tipi che hanno davvero dei task.
 */
export interface PagedTasks extends Paged<TaskListItem> {
  facets: {
    statuses: Array<{ id: string; name: string; count: number }>;
    assignees: Array<{ id: string; name: string; count: number }>;
    activityTypes: Array<{ id: string; name: string; count: number }>;
    /**
     * Clienti con almeno un task, col loro numero. Il cliente non è un campo
     * del task — arriva dalle sue relazioni — quindi qui è già risolto.
     */
    companies: Array<{ id: string; name: string; count: number }>;
    /**
     * Aree di lavoro che hanno davvero dei task, col loro numero: il selettore
     * non offre un'area vuota (nello scadenzario, per dire, i task tecnici non
     * esistono — stanno nei progetti). Calcolata SENZA il filtro area, o
     * sceglierne una lascerebbe solo quella.
     */
    areas: Array<{ category: ActivityCategory; count: number }>;
  };
}

export const taskSortBySchema = z.enum(["title", "status", "assignee", "dueDate", "createdAt"]);
export type TaskSortBy = z.infer<typeof taskSortBySchema>;
export const sortDirSchema = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof sortDirSchema>;

export const taskFiltersSchema = paginationSchema.extend({
  statusId: z.string().optional(),
  assigneeId: z.string().optional(),
  projectId: z.string().optional(),
  activityTypeId: z.string().optional(),
  /** Filtra i task che portano questo tag. */
  tagId: z.string().optional(),
  /**
   * Cliente. Non è un campo del task: si risolve dalle sue relazioni (offerta,
   * progetto) con la precedenza dichiarata in `modules/tasks/company.ts`, la
   * stessa con cui l'azienda compare in elenco.
   */
  companyId: z.string().optional(),
  q: z.string().optional(),
  includeClosed: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .optional(),
  sortBy: taskSortBySchema.optional(),
  sortDir: sortDirSchema.optional(),
  /** Range di scadenza: scaduti + entro N giorni; esclude i senza data. */
  dueWithinDays: z.coerce.number().int().positive().optional(),
  /**
   * Area di lavoro (tendina delle bacheche, viste agenda e tabella): vince il
   * tipo di mestiere; i tipi Generali e i task senza tipo ricadono nella
   * categoria del modulo — la stessa regola di `statusCategoryOf`.
   */
  category: z.nativeEnum(ActivityCategory).optional(),
  /**
   * Riepilogo completo: oltre allo scadenzario include anche i **task di
   * progetto** visibili, così il lavoro tecnico si legge tutto insieme senza
   * entrare progetto per progetto (11/08/2026). Vale solo senza `projectId`
   * (dentro un progetto la lista è già la sua).
   */
  includeProjectTasks: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .optional(),
});
export type TaskFilters = z.infer<typeof taskFiltersSchema>;

export const createCommentSchema = z
  .object({
    /**
     * Può essere **vuoto**, ma solo con un allegato: «ecco il file» senza altro da
     * dire è un messaggio a tutti gli effetti, e obbligare a scriverci sopra una
     * parola qualunque non aiuta nessuno. Senza file, invece, un messaggio vuoto
     * non è niente.
     */
    body: z.string().max(5000),
    /** Incontro in cui è stata presa la nota (facoltativo). */
    meetingId: z.string().nullish(),
    /**
     * Allegati **già caricati sul task** da legare a questo messaggio: il browser
     * carica prima i file (l'endpoint degli allegati, con i suoi permessi e i suoi
     * formati ammessi) e qui manda soltanto gli identificativi. Il server accetta
     * solo quelli che stanno davvero su questo task.
     */
    attachmentIds: z.array(z.string()).max(10).optional(),
    /**
     * **Manda lo stesso, anche se la richiesta è in carico a un collega.**
     *
     * La presa in carico non è un permesso: è una cortesia fra colleghi, che
     * evita due risposte scritte insieme e in contraddizione. Ma a volte quella
     * seconda risposta serve davvero — il collega è in riunione, o ha preso la
     * richiesta e se n'è dimenticato — e l'unica alternativa era aspettare che
     * la presa in carico scadesse.
     *
     * Vale **solo per questo messaggio**: non toglie la presa in carico e non
     * la sposta. Il collega vede il messaggio come tutti gli altri.
     */
    forza: z.boolean().optional(),
  })
  .refine((input) => input.body.trim() !== "" || (input.attachmentIds?.length ?? 0) > 0, {
    message: "Scrivi un messaggio, o allega un file",
    path: ["body"],
  });
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/**
 * Solo indirizzi web. `z.string().url()` da solo accetta anche `javascript:`,
 * `data:` e `file:`: un link `javascript:` cliccato da un collega eseguirebbe
 * codice nella sua sessione (i link si aggiungono anche dal portale clienti,
 * sui ticket). Stesso controllo lato server all'apertura, per i link storici.
 */
export const isWebUrl = (value: string): boolean => /^https?:\/\//i.test(value);

export const createLinkAttachmentSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url().refine(isWebUrl, "Il link deve iniziare con http:// o https://"),
  /**
   * Tipo del documento collegato, quando chi lo aggiunge lo conosce (il
   * selettore Drive lo sa; l'incolla-link no). Serve solo a mostrare l'icona
   * giusta e ad aprire l'anteprima corretta: mai a decidere permessi.
   */
  mimeType: z.string().max(200).nullish(),
});
export type CreateLinkAttachmentInput = z.infer<typeof createLinkAttachmentSchema>;

/**
 * Che cosa è un link Google Workspace, per icona ed etichetta. Punto unico
 * client/server: la lista allegati mostra il segno giusto (documento, foglio,
 * presentazione, cartella…) e ognuno sa cos'è prima di aprirlo. I `mimeType`
 * sono quelli del Drive (application/vnd.google-apps.*).
 */
export type DriveKind = "document" | "spreadsheet" | "presentation" | "folder" | "pdf" | "generic";
export function driveKindOf(mimeType: string | null | undefined): DriveKind {
  switch (mimeType ?? "") {
    case "application/vnd.google-apps.document":
      return "document";
    case "application/vnd.google-apps.spreadsheet":
      return "spreadsheet";
    case "application/vnd.google-apps.presentation":
      return "presentation";
    case "application/vnd.google-apps.folder":
      return "folder";
    case "application/pdf":
      return "pdf";
    default:
      return "generic";
  }
}

/**
 * URL di anteprima incorporabile di un link Google Workspace, o null se il
 * documento non si può incorporare (o non è un link Google). Docs, Sheets,
 * Slides e i file Drive espongono la variante `/preview`, pensata da Google per
 * l'iframe: la si ricava dall'URL canonico senza chiamare nessuna API. Le
 * cartelle e la variante "aperta" (`open?id=`) restano solo esterne.
 */
export function drivePreviewUrl(url: string): string | null {
  const match = url.match(
    /^https:\/\/(docs|drive)\.google\.com\/(document|spreadsheets|presentation|file)\/d\/([\w-]+)/,
  );
  if (!match) return null;
  return `https://${match[1]}.google.com/${match[2]}/d/${match[3]}/preview`;
}
