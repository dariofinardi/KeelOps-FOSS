import { z } from "zod";
import { ActivityCategory, TaskKind, TicketPriority } from "../enums";
import { dateOnly, taskListItemSchema } from "./tasks";

export const dashboardStatusCountSchema = z.object({
  /** Id dello stato: la dashboard ci apre l'elenco già filtrato. */
  id: z.string(),
  name: z.string(),
  /** Categoria dello stato: serve a distinguere gli omonimi di liste diverse. */
  category: z.nativeEnum(ActivityCategory),
  color: z.string(),
  count: z.number().int(),
  /**
   * Tipo di task prevalente in questo gruppo (ADMIN | PROJECT | TICKET | DEAL):
   * dice a quale elenco portare, dato che ogni modulo ha la sua lista.
   */
  kind: z.nativeEnum(TaskKind),
});

const riferimento = z.object({ id: z.string(), name: z.string() });

export const dashboardDealSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Azienda e interlocutore: la riga sotto il titolo, come sui task (05/09/2026). */
  company: riferimento.nullable(),
  contact: riferimento.nullable(),
  stageName: z.string(),
  stageColor: z.string(),
  dealValue: z.number().nullable(),
  expectedCloseDate: dateOnly.nullable(),
});

export const dashboardTicketSchema = z.object({
  id: z.string(),
  title: z.string(),
  priority: z.nativeEnum(TicketPriority),
  statusName: z.string(),
  statusColor: z.string(),
  requesterName: z.string(),
});

/**
 * Una sezione delle scadenze: i task di cui l'utente è assegnatario e, a parte,
 * quelli di cui è SOLO supervisore (chi è entrambi conta una volta, tra i suoi).
 * La dashboard mostra i due contatori e fa scegliere quale lista guardare.
 */
export const deadlineSectionSchema = z.object({
  mine: z.array(taskListItemSchema),
  supervised: z.array(taskListItemSchema),
});
export type DeadlineSection = z.infer<typeof deadlineSectionSchema>;

export const dashboardSchema = z.object({
  overdue: deadlineSectionSchema,
  dueToday: deadlineSectionSchema,
  /** Scadenze di domani: anteprima per preparare la giornata. */
  dueTomorrow: deadlineSectionSchema,
  /** Da dopodomani, per i tre giorni successivi: l'orizzonte corto. */
  nextDays: deadlineSectionSchema,
  /**
   * Aperti **senza scadenza**. Non sono "la giornata", ma senza questa sezione
   * sparivano del tutto: un task supervisionato e senza data non compariva in
   * nessuno dei riquadri, e chi lo segue non lo trovava (è successo con
   * "Consegna beta").
   */
  noDueDate: deadlineSectionSchema,
  /** Task non assegnati che l'utente può prendere in carico. */
  unassignedTasks: z.array(taskListItemSchema),
  myTasksByStatus: z.array(dashboardStatusCountSchema),
  myOpenTaskCount: z.number().int(),
  /**
   * Le offerte aperte, divise per perimetro: **le mie** e **quelle degli
   * altri**, ognuna con il proprio totale.
   *
   * Arrivano tutte e due insieme perché le due pastiglie mostrano i numeri di
   * entrambe — «si guarda una lista alla volta, e il numero dice cosa c'è
   * nell'altra», come per i task. Le liste sono corte (le prime cinque per
   * scadenza), i totali no: quelli contano tutto.
   */
  openDeals: z.object({
    mine: z.array(dashboardDealSchema),
    others: z.array(dashboardDealSchema),
    mineTotal: z.number().int(),
    othersTotal: z.number().int(),
  }),
  openTickets: z.array(dashboardTicketSchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const searchResultSchema = z.object({
  type: z.enum([
    "task",
    "deal",
    "ticket",
    "project",
    "recurrence",
    "comment",
    "attachment",
    "contact",
    "company",
  ]),
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  projectId: z.string().nullish(),
  /** Per messaggi e allegati: il task da aprire (il match è dentro di lui). */
  taskId: z.string().nullish(),
  taskKind: z.string().nullish(),
  /**
   * Il task è **chiuso**. La ricerca i chiusi li ha sempre trovati — un task
   * completato non è cancellato, e cercarlo è normale — ma nel risultato non si
   * distingueva: su un task di progetto il sottotitolo porta il progetto, non
   * lo stato, quindi "Non rinnova più" e "In sviluppo" si leggevano uguali
   * (19/08/2026). Con il nome dello stato accanto si sa cosa si sta aprendo.
   */
  closed: z.boolean().optional(),
  statusName: z.string().nullish(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
