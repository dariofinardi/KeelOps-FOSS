// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { ActivityCategory, TaskKind } from "../enums";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colore esadecimale non valido");

export const taskStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Categoria di attività a cui appartiene lo stato (vedi statusCategoryOf). */
  category: z.nativeEnum(ActivityCategory),
  color: z.string(),
  order: z.number().int(),
  isClosed: z.boolean(),
  /** Stato in cui nasce il task amministrativo di un'offerta vinta (uno solo). */
  isWonTarget: z.boolean(),
  /** Stato dei task assegnati, uno per categoria (vedi assignedStatus). */
  isAssignedTarget: z.boolean(),
  /** Stato chiuso che interrompe la ricorrenza (es. "Annullato"): non fa avanzare. */
  stopsRecurrence: z.boolean(),
  /**
   * **Attività amministrativa**: entrare in questo stato è un evento da
   * fatturare (consegna beta, consegna in produzione, collaudo). Il task avvisa
   * l'amministrazione e compare nel suo elenco delle attività da fatturare.
   */
  isBillingMilestone: z.boolean(),
  /**
   * Limite WIP: quanti task **di uno stesso progetto** possono stare insieme in
   * questo stato prima che diventi un avviso. `null` = nessun limite, ed è come
   * nascono tutti gli stati. Non blocca lo spostamento: avvisa.
   */
  wipLimit: z.number().int().positive().nullable(),
});
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const createTaskStatusSchema = z.object({
  name: z.string().min(1).max(50),
  category: z.nativeEnum(ActivityCategory),
  color: hexColor,
  isClosed: z.boolean().default(false),
  isWonTarget: z.boolean().default(false),
  isAssignedTarget: z.boolean().default(false),
  stopsRecurrence: z.boolean().default(false),
  isBillingMilestone: z.boolean().default(false),
  wipLimit: z.number().int().positive().nullable().default(null),
});
export type CreateTaskStatusInput = z.infer<typeof createTaskStatusSchema>;

/** La categoria di uno stato non si cambia: sposterebbe i task in un altro flusso. */
export const updateTaskStatusSchema = createTaskStatusSchema.omit({ category: true }).partial();
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;

/** Riordino: gli id devono appartenere tutti alla stessa categoria. */
export const reorderTaskStatusesSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderTaskStatusesInput = z.infer<typeof reorderTaskStatusesSchema>;

/**
 * Categoria "di casa" di ogni modulo: è la lista di stati e di tipi di attività
 * con cui si lavora lì dentro.
 */
export const MODULE_CATEGORY: Record<string, ActivityCategory> = {
  [TaskKind.ADMIN]: ActivityCategory.ADMIN,
  [TaskKind.PROJECT]: ActivityCategory.DEV,
  [TaskKind.DEAL]: ActivityCategory.SALES,
  [TaskKind.TICKET]: ActivityCategory.GENERAL,
};

export function moduleCategory(kind: string | null | undefined): ActivityCategory {
  return (kind && MODULE_CATEGORY[kind]) || ActivityCategory.GENERAL;
}

/**
 * Categoria degli stati utilizzabili da un task.
 *
 * Vince il tipo di attività quando appartiene a una categoria di mestiere
 * (amministrativa, commerciale, sviluppo). I tipi **Generali** sono trasversali —
 * "Riunione" ha senso ovunque — e non spostano il task in un flusso a parte:
 * come quando il tipo manca, decide il modulo. Così una riunione di progetto
 * resta sulla bacheca del progetto e una riunione amministrativa nello
 * scadenzario, invece di sparire in una bacheca "Generali".
 */
export function statusCategoryOf(
  task: { activityType?: { category: string } | null; kind?: string } | null | undefined,
): ActivityCategory {
  const category = task?.activityType?.category;
  if (category && category in ActivityCategory && category !== ActivityCategory.GENERAL) {
    return category as ActivityCategory;
  }
  return moduleCategory(task?.kind);
}

/** Ciò che serve per rimappare uno stato: identità, apertura, categoria, ordine. */
export interface RemappableStatus {
  id: string;
  name: string;
  isClosed: boolean;
  category: string;
  order: number;
}

/**
 * Lo stato **equivalente** nella categoria di destinazione quando un task cambia
 * modulo o tipo di attività (scadenzario ADMIN → sviluppo DEV, offerta SALES →
 * sviluppo, …).
 *
 * La regola, in ordine: **stesso nome** se esiste ("In attesa" resta "In
 * attesa"); altrimenti la **stessa posizione** tra gli stati con la stessa
 * apertura — un task chiuso resta chiuso, e il terzo degli aperti diventa il
 * terzo degli aperti di là; se non c'è, il primo di quella apertura; in ultima
 * istanza il primo della categoria. `undefined` solo se la destinazione non ha
 * stati configurati.
 *
 * È il **default intelligente** che il dialog di spostamento mostra e lascia
 * cambiare, ed è la stessa scelta che il server applica quando nessuno indica
 * uno stato: regola unica, così ciò che si vede prima è ciò che poi succede.
 */
export function equivalentStatusId(
  current: RemappableStatus | null | undefined,
  allStatuses: RemappableStatus[],
  targetCategory: string,
): string | undefined {
  const target = allStatuses
    .filter((s) => s.category === targetCategory)
    .sort((a, b) => a.order - b.order);
  if (target.length === 0) return undefined;
  if (!current) return target[0]!.id;

  const sameName = target.find((s) => s.name === current.name);
  if (sameName) return sameName.id;

  const sameOpenness = target.filter((s) => s.isClosed === current.isClosed);
  if (sameOpenness.length > 0) {
    const siblings = allStatuses
      .filter((s) => s.category === current.category && s.isClosed === current.isClosed)
      .sort((a, b) => a.order - b.order);
    const position = siblings.findIndex((s) => s.id === current.id);
    return (sameOpenness[position] ?? sameOpenness[0]!).id;
  }
  return target[0]!.id;
}

/**
 * **Fondere due stati**: i task del primo passano al secondo.
 *
 * Serve a rimettere ordine in un flusso cresciuto male ("In review" e "Da
 * testare" fanno la stessa cosa) senza dover riaprire i task uno per uno. Non
 * elimina lo stato di partenza — svuotarlo e cancellarlo restano due gesti,
 * così chi sbaglia la scelta non ha anche perso la configurazione — ma dopo la
 * fusione il pulsante di eliminazione non ha più task da segnalare.
 *
 * Vale **dentro una categoria**: l'area di un task è quella del suo stato, e
 * portarlo in un'altra area vorrebbe dire spostare il task di reparto senza
 * dirlo. Vedi `mergeTaskStatus` nel modulo server.
 */
export const mergeTaskStatusSchema = z.object({
  /** Lo stato che riceve i task. */
  targetId: z.string().min(1),
});
export type MergeTaskStatusInput = z.infer<typeof mergeTaskStatusSchema>;

/**
 * Cosa succederebbe: si mostra **prima** di chiedere conferma, perché "n record
 * verranno modificati" è l'unica informazione che permette di accorgersi di aver
 * scelto lo stato sbagliato.
 */
export const taskStatusMergePreviewSchema = z.object({
  /** Task da spostare (fuori dal cestino): il numero che si legge in pagina. */
  tasks: z.number(),
  /** Task nel cestino che portano lo stato: si spostano anche loro, o lo stato non si svuota. */
  trashed: z.number(),
  /** Ricorrenze che nascono in quello stato: il riferimento segue la fusione. */
  recurrences: z.number(),
  /** Fasi pipeline che generano un task in quello stato: anche quelle seguono. */
  dealStages: z.number(),
  /**
   * I task diventeranno chiusi (o torneranno aperti) perché i due stati non
   * concordano su `isClosed`. È la conseguenza meno prevedibile della fusione:
   * va detta prima, non scoperta dopo.
   */
  closes: z.boolean(),
  reopens: z.boolean(),
  /**
   * Contrassegni che **passano allo stato di arrivo** (destinazione delle
   * offerte vinte, stato dei task assegnati, attività amministrativa,
   * interrompe ricorrenza). Dicono "in quest'area, lo stato che fa X": se
   * quello stato viene assorbito, il ruolo va con lui — altrimenti, eliminando
   * lo stato di partenza, l'area resterebbe senza e nessuno se ne accorgerebbe
   * fino al primo caso reale. Vuoto se non ce ne sono, o se li ha già il
   * destinatario.
   */
  flags: z.array(z.string()),
});
export type TaskStatusMergePreview = z.infer<typeof taskStatusMergePreviewSchema>;

/** Cosa è stato fatto, per il messaggio finale. */
export const taskStatusMergeResultSchema = z.object({
  migrated: z.number(),
  trashed: z.number(),
  recurrences: z.number(),
  dealStages: z.number(),
  /** Nome dello stato di partenza, eliminato al termine perché ormai vuoto. */
  deleted: z.string(),
  /** Contrassegni passati allo stato di arrivo. */
  flagsMoved: z.array(z.string()),
});
export type TaskStatusMergeResult = z.infer<typeof taskStatusMergeResultSchema>;
