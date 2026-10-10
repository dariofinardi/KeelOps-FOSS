// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { MOTIVI_OFFERTA_FERMA, type FiltroOfferteFerme } from "../deal-next-step";
import { dealStageSchema } from "./deal-stages";
import {
  dateOnly,
  paginationSchema,
  sortDirSchema,
  taskDetailSchema,
  userRefSchema,
  type Paged,
} from "./tasks";

const refSchema = z.object({ id: z.string(), name: z.string() });

export const dealListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  stage: dealStageSchema,
  company: refSchema.nullable(),
  contact: refSchema.nullable(),
  assignee: userRefSchema.nullable(),
  dealValue: z.number().nullable(),
  probability: z.number().int().nullable(),
  expectedCloseDate: dateOnly.nullable(),
  /** Giorno in cui è stata vinta o persa: è la data su cui la si conta. */
  closedAt: dateOnly.nullable(),
  attachmentCount: z.number().int(),
  commentCount: z.number().int(),
  /** Task dello scadenzario collegati e ancora aperti. */
  openTaskCount: z.number().int(),
  /**
   * Il prossimo passo: il primo task aperto collegato, per scadenza (vedi
   * `deal-next-step.ts`). Null se l'offerta non ne ha.
   */
  nextStep: z
    .object({
      id: z.string(),
      title: z.string(),
      dueDate: dateOnly.nullable(),
      assigneeName: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
  billingTaskId: z.string().nullable(),
  /** Progetto di sviluppo nato da questa offerta vinta, se è stato creato. */
  projectId: z.string().nullable(),
  lostReason: z.string().nullable(),
  /** Esposta ai monitor vendite: l'elenco lo segnala con un'icona. */
  visibleToSalesMonitors: z.boolean(),
  /** L'utente corrente può modificare questa offerta (admin o proprietario). */
  canEdit: z.boolean(),
});
export type DealListItem = z.infer<typeof dealListItemSchema>;

/** Task dello scadenzario collegato a un'offerta (vista sintetica sul dettaglio). */
export const linkedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: dealStageSchema.pick({ name: true, color: true }),
  dueDate: dateOnly.nullable(),
  isClosed: z.boolean(),
});
export type LinkedTask = z.infer<typeof linkedTaskSchema>;

/** Dettaglio deal: tutto il dettaglio task (allegati, commenti, attività) + campi deal. */
export const dealDetailSchema = taskDetailSchema.extend({
  stage: dealStageSchema,
  company: refSchema.nullable(),
  contact: refSchema.nullable(),
  dealValue: z.number().nullable(),
  probability: z.number().int().nullable(),
  expectedCloseDate: dateOnly.nullable(),
  billingTaskId: z.string().nullable(),
  /** Progetto di sviluppo nato da questa offerta vinta, se è stato creato. */
  projectId: z.string().nullable(),
  lostReason: z.string().nullable(),
  /** Esposta ai monitor vendite nella loro area riservata (sola lettura). */
  visibleToSalesMonitors: z.boolean(),
  /** L'utente corrente può modificare questa offerta (admin o proprietario). */
  canEdit: z.boolean(),
  /** Task dello scadenzario collegati a questa offerta. */
  linkedTasks: z.array(linkedTaskSchema),
  /**
   * Presente **solo** nella risposta a una modifica che ha riportato l'offerta
   * in fase vinta trovando una lettura già fatta: vedi `dealAnalysisNoticeSchema`.
   */
  analysisNotice: z.object({ fattaIl: z.string(), applicata: z.boolean() }).nullish(),
  /**
   * Anche questo **solo** nella risposta a una modifica: com'è andata la messa
   * in lettura entrando in fase vinta. Serve a dire a chi ha spostato l'offerta
   * che sta succedendo qualcosa — la proposta arriva fra qualche minuto — o che
   * non succederà perché il modello è spento.
   */
  analysisState: z.enum(["in-coda", "senza-modello", "senza-allegati", "gia-fatta"]).nullish(),
});
/**
 * **Avviso di una modifica, non un campo dell'offerta.** Compare solo nella
 * risposta a una PATCH: dice che la lettura degli allegati non è ripartita
 * perché ce n'è già una. Un'offerta può rientrare in fase vinta — si sposta
 * indietro per correggere e si riporta avanti — e la seconda volta rifare la
 * lettura sovrascriverebbe le correzioni del commerciale, o farebbe nascere un
 * secondo gruppo di task uguale al primo.
 */
export const dealAnalysisNoticeSchema = z.object({
  fattaIl: z.string(),
  /** I task da quella lettura erano già stati creati. */
  applicata: z.boolean(),
});

export type DealDetail = z.infer<typeof dealDetailSchema>;
export type DealAnalysisNotice = z.infer<typeof dealAnalysisNoticeSchema>;

export const createDealSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).nullish(),
  stageId: z.string().optional(),
  companyId: z.string().nullish(),
  contactId: z.string().nullish(),
  assigneeId: z.string().nullish(),
  dealValue: z.number().min(0).nullish(),
  probability: z.number().int().min(0).max(100).nullish(),
  expectedCloseDate: dateOnly.nullish(),
  /**
   * Espone l'offerta nell'area riservata dei monitor vendite. Dal 21/09/2026
   * si sceglie già alla creazione, come la descrizione: prima si creava e poi
   * si riapriva il pannello per farlo, due passaggi per una cosa sola.
   */
  visibleToSalesMonitors: z.boolean().optional(),
});
export type CreateDealInput = z.infer<typeof createDealSchema>;

export const updateDealSchema = createDealSchema.partial().extend({
  /** Motivo della perdita (richiesto dalla UI quando la fase è isLost). */
  lostReason: z.string().max(2000).nullish(),
  /**
   * La data di chiusura effettiva di un'offerta vinta o persa, corretta a mano
   * (01/10/2026): la scrive il passaggio di fase, ma un'offerta registrata a
   * cose fatte risulta chiusa il giorno dell'inserimento. **Solo un super
   * admin**, e solo su un'offerta conclusa: il server lo verifica.
   */
  closedAt: dateOnly.optional(),
});
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

/**
 * **Un'offerta creata da un task** (06/10/2026): titolo e descrizione arrivano
 * proposti dal task, il cliente da quello del task o del suo progetto. Il server
 * aggiunge da sé il link al task di origine fra gli allegati. Il valore è
 * obbligatorio se l'offerta nasce vinta: lo verifica il server, che conosce la fase.
 */
export const createDealFromTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).nullish(),
  stageId: z.string().optional(),
  companyId: z.string().nullish(),
  assigneeId: z.string().nullish(),
  dealValue: z.number().min(0).nullish(),
});
export type CreateDealFromTaskInput = z.infer<typeof createDealFromTaskSchema>;

export const dealSortBySchema = z.enum([
  "title",
  "stage",
  "company",
  "assignee",
  "value",
  "probability",
  "expectedCloseDate",
  "createdAt",
  /** Il prossimo passo: prima i più vicini (scaduti in testa), in fondo le offerte senza. */
  "nextStep",
]);
export type DealSortBy = z.infer<typeof dealSortBySchema>;

/** Filtro sul valore, relativo alla media delle offerte che passano gli altri filtri. */
export const dealValueFilterSchema = z.enum(["above", "below"]);
export type DealValueFilter = z.infer<typeof dealValueFilterSchema>;

/**
 * **Di chi sono le offerte da guardare.** Con quindici persone e un centinaio di
 * offerte, «le mie» è la domanda che ci si fa per prima e non aveva risposta:
 * si scorreva l'elenco intero cercando il proprio nome (04/09/2026).
 *
 * Proprietario di un'offerta = il commerciale assegnato, o chi l'ha creata se
 * non è assegnata a nessuno. È la stessa definizione che decide chi la può
 * modificare, e sono la stessa cosa apposta.
 */
export const dealOwnerFilterSchema = z.enum(["mine", "others", "all"]);
export type DealOwnerFilter = z.infer<typeof dealOwnerFilterSchema>;

export const dealFiltersSchema = paginationSchema.extend({
  owner: dealOwnerFilterSchema.optional(),
  stageId: z.string().optional(),
  companyId: z.string().optional(),
  value: dealValueFilterSchema.optional(),
  q: z.string().optional(),
  includeClosed: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .optional(),
  sortBy: dealSortBySchema.optional(),
  sortDir: sortDirSchema.optional(),
  /** Offerte ferme: tutte, o una ragione sola (vedi `deal-next-step.ts`). */
  stalled: z.enum(["tutte", ...MOTIVI_OFFERTA_FERMA]).optional(),
  /**
   * Mesi di chiusura, più d'uno: `2026-09,2026-10,senza-data` (03/10/2026). Il
   * mese è quello di `dealMonthKey`: chiusura effettiva, poi prevista.
   */
  months: z.string().optional(),
});
export type DealFilters = z.infer<typeof dealFiltersSchema>;

/** Valore di un filtro effettivamente presente nei dati, col numero di record. */
export interface FacetOption {
  id: string;
  name: string;
  count: number;
}

/**
 * Lista offerte: oltre alla pagina restituisce la media dei valori su cui si basa
 * il filtro sopra/sotto media, e i valori disponibili per i filtri — così le
 * tendine propongono solo clienti e fasi che hanno davvero delle offerte.
 */
/**
 * In che unità sono espressi i valori di questa risposta. Per i gruppi con le
 * Offerte in "Giornate" il server converte prima di rispondere: nel payload non
 * viaggia nessun importo in euro, e chi disegna la tabella non deve sapere
 * perché — legge l'unità e formatta.
 */
export type DealValueUnit = "EUR" | "DAYS";

export interface PagedDeals extends Paged<DealListItem> {
  averageValue: number | null;
  /** Somma dei valori dell'insieme filtrato, tutte le pagine: nominale, senza pesi. */
  totalValue: number | null;
  valueUnit: DealValueUnit;
  facets: {
    companies: FacetOption[];
    stages: FacetOption[];
    /**
     * Quante offerte aperte sono ferme, per ragione e in tutto. Si contano con
     * gli altri filtri ma **senza** quello «Ferme», come ogni tendina.
     */
    stalled: Record<FiltroOfferteFerme, number>;
    /**
     * I mesi di chiusura presenti, con quante offerte (`senza-data` in fondo),
     * calcolati sull'insieme di partenza come clienti e fasi.
     */
    months: Array<{ key: string; count: number }>;
  };
}

export const VisibilityScope = {
  ADMIN_TASKS: "ADMIN_TASKS",
  DEALS: "DEALS",
  TICKETS: "TICKETS",
  /** Persone/contatti CRM. Le aziende sono visibili a tutti gli utenti interni. */
  CONTACTS: "CONTACTS",
  /**
   * Progetti e loro task (area sviluppo). Si somma ai permessi per singolo
   * progetto: READ equivale a essere osservatore di tutti i progetti, FULL a
   * poterne modificare i task. La membership resta il modo di dare permessi
   * più alti (o l'accesso a chi non ha lo scope).
   */
  PROJECTS: "PROJECTS",
} as const;
export type VisibilityScope = (typeof VisibilityScope)[keyof typeof VisibilityScope];

/** Etichette dei moduli nei pannelli di visibilità. */
export const VISIBILITY_SCOPE_LABELS: Record<VisibilityScope, string> = {
  ADMIN_TASKS: "Scadenzario",
  DEALS: "Offerte",
  TICKETS: "Ticket",
  CONTACTS: "Persone (contatti)",
  PROJECTS: "Progetti (sviluppo)",
};

/**
 * Livello di accesso di un gruppo a un modulo: READ lo rende consultabile ma non
 * modificabile, FULL permette di lavorarci. Vale per tutti i moduli.
 */
export const VisibilityAccess = {
  READ: "READ",
  FULL: "FULL",
  /**
   * Solo per le **Offerte**: elenco in sola consultazione con il valore espresso
   * in giornate di lavoro (vedi `DEV_DAY_RATE`), senza dettaglio, allegati,
   * contatti né dati commerciali. È la lente degli sviluppatori — non un accesso
   * al modulo, tant'è che `accessForScope` non la restituisce mai.
   */
  DAYS: "DAYS",
} as const;
export type VisibilityAccess = (typeof VisibilityAccess)[keyof typeof VisibilityAccess];

export const visibilityGroupSchema = z.object({
  groupId: z.string(),
  access: z.nativeEnum(VisibilityAccess),
});
export type VisibilityGroup = z.infer<typeof visibilityGroupSchema>;

export const updateVisibilitySchema = z
  .object({
    scope: z.nativeEnum(VisibilityScope),
    groups: z.array(visibilityGroupSchema),
  })
  // "Giornate" descrive una lente sulle offerte: sugli altri moduli non vuol
  // dire niente, e accettarla creerebbe un livello che nessuno sa interpretare.
  .refine(
    (input) =>
      input.scope === VisibilityScope.DEALS ||
      input.groups.every((g) => g.access !== VisibilityAccess.DAYS),
    { message: "Il livello Giornate esiste solo per le Offerte" },
  );
export type UpdateVisibilityInput = z.infer<typeof updateVisibilitySchema>;
