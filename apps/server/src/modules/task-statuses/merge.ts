// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  ActivityCategory,
  type TaskStatusMergePreview,
  type TaskStatusMergeResult,
} from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest, notFound } from "../../lib/http-errors";
import type { TaskStatus, User } from "../../generated/prisma/client";

/**
 * **Fondere uno stato in un altro**: i task del primo passano al secondo.
 *
 * Nasce da un flusso cresciuto male — "In review" e "Da testare" che fanno la
 * stessa cosa — e dal fatto che l'unica alternativa era riaprire i task uno per
 * uno, o cancellare lo stato dopo averli spostati a mano (l'eliminazione li
 * conta e si rifiuta, giustamente).
 *
 * Quattro cose che si perdono facendola "solo" con un `updateMany`, e che qui
 * non si perdono:
 *
 *  1. **Il cestino.** Un task cestinato porta ancora il suo stato: lasciandolo
 *     indietro, lo stato non si svuota e l'eliminazione continua a rifiutarsi
 *     parlando di task che nessuno vede. Si spostano anche quelli, e si contano
 *     a parte.
 *  2. **I riferimenti.** Una ricorrenza nasce in uno stato
 *     (`RecurrenceTemplate.initialStatusId`) e una fase vinta genera un task in
 *     uno stato (`DealStage.wonTaskStatusId`). Sono `onDelete: SetNull`: senza
 *     spostarli, il giorno in cui si elimina lo stato svuotato quella
 *     configurazione sparisce senza un avviso.
 *  3. **La data di chiusura.** Se i due stati non concordano su `isClosed`, i
 *     task cambiano natura: `closedAt` va scritto o azzerato, o i conteggi dei
 *     chiusi e i tempi dell'area raccontano un'altra storia.
 *  4. **La traccia.** Ogni task riceve una riga di storico che dice da dove
 *     viene: un cambio di stato in massa senza traccia, letto sei mesi dopo, è
 *     indistinguibile da un errore.
 *
 * **Alla fine lo stato di partenza viene eliminato** (18/08/2026): è rimasto
 * vuoto per costruzione, e lasciarlo in elenco vorrebbe dire che il flusso che
 * si stava mettendo in ordine ha ancora la voce che si voleva togliere — la
 * fusione l'avrebbe fatta a metà. Per questo i **contrassegni passano allo
 * stato di arrivo**: `isWonTarget`, `isAssignedTarget`, `isBillingMilestone` e
 * `stopsRecurrence` dicono "in quest'area, lo stato che fa X", e se quello
 * stato viene assorbito da un altro il ruolo va con lui. Cancellarlo senza
 * spostarli lascerebbe l'area **senza** una destinazione per le offerte vinte
 * o senza lo stato dei task assegnati, e nessuno se ne accorgerebbe fino al
 * primo caso reale. Un contrassegno che lo stato di arrivo ha già non si
 * duplica: resta il suo.
 *
 * Cosa **non** fa: **non manda notifiche**. È una manutenzione della
 * configurazione, non sessanta cambi di stato fatti da una persona.
 */

/** L'azione, nel registro attività: si distingue da un cambio di stato a mano. */
export const MERGE_ACTION = "status_merged";

async function pair(sourceId: string, targetId: string): Promise<[TaskStatus, TaskStatus]> {
  if (sourceId === targetId) throw badRequest("Scegli due stati diversi");
  const [source, target] = await Promise.all([
    prisma.taskStatus.findUnique({ where: { id: sourceId } }),
    prisma.taskStatus.findUnique({ where: { id: targetId } }),
  ]);
  if (!source) throw notFound("Stato di partenza non trovato");
  if (!target) throw notFound("Stato di arrivo non trovato");
  if (source.category !== target.category) {
    // L'area di un task è quella del suo stato: portarlo in un'altra categoria
    // vorrebbe dire cambiargli reparto senza dirlo.
    throw badRequest("Si possono fondere solo stati della stessa area");
  }
  return [source, target];
}

/** I task che portano lo stato, dentro e fuori dal cestino. */
async function taskIds(statusId: string): Promise<{ active: string[]; trashed: string[] }> {
  // Le due query sono esplicite invece di aggirare il filtro del cestino: qui
  // servono **tutti** i task, e dirlo con `deletedAt` scritto due volte è più
  // chiaro di un `undefined` che disattiva un'estensione.
  const [active, trashed] = await Promise.all([
    prisma.task.findMany({ where: { statusId, deletedAt: null }, select: { id: true } }),
    prisma.task.findMany({ where: { statusId, deletedAt: { not: null } }, select: { id: true } }),
  ]);
  return { active: active.map((t) => t.id), trashed: trashed.map((t) => t.id) };
}

/**
 * I contrassegni che passano allo stato di arrivo, con la loro etichetta.
 *
 * Solo quelli che il destinatario **non ha già**: `isWonTarget` e
 * `isAssignedTarget` valgono uno per area, e riscriverli quando ci sono già
 * sarebbe una modifica inutile a un dato che va bene com'è.
 */
const MERGE_FLAGS = [
  ["isWonTarget", "Da offerta vinta"],
  ["isAssignedTarget", "Task assegnati"],
  ["isBillingMilestone", "Attività amministrativa"],
  ["stopsRecurrence", "Interrompe ricorrenza"],
] as const satisfies ReadonlyArray<readonly [keyof TaskStatus, string]>;

function flagsToMove(
  source: TaskStatus,
  target: TaskStatus,
): { data: Record<string, boolean>; labels: string[] } {
  const data: Record<string, boolean> = {};
  const labels: string[] = [];
  for (const [key, label] of MERGE_FLAGS) {
    if (source[key] && !target[key]) {
      data[key] = true;
      labels.push(label);
    }
  }
  return { data, labels };
}

export async function previewMerge(
  sourceId: string,
  targetId: string,
): Promise<TaskStatusMergePreview & { category: ActivityCategory }> {
  const [source, target] = await pair(sourceId, targetId);
  const ids = await taskIds(sourceId);
  const [recurrences, dealStages] = await Promise.all([
    prisma.recurrenceTemplate.count({ where: { initialStatusId: sourceId } }),
    prisma.dealStage.count({ where: { wonTaskStatusId: sourceId } }),
  ]);
  return {
    tasks: ids.active.length,
    trashed: ids.trashed.length,
    recurrences,
    dealStages,
    closes: !source.isClosed && target.isClosed,
    reopens: source.isClosed && !target.isClosed,
    flags: flagsToMove(source, target).labels,
    category: source.category as ActivityCategory,
  };
}

export async function mergeTaskStatus(
  user: User,
  sourceId: string,
  targetId: string,
): Promise<TaskStatusMergeResult> {
  const [source, target] = await pair(sourceId, targetId);
  const ids = await taskIds(sourceId);
  const all = [...ids.active, ...ids.trashed];
  const now = new Date();
  const [recurrences, dealStages] = await Promise.all([
    prisma.recurrenceTemplate.count({ where: { initialStatusId: sourceId } }),
    prisma.dealStage.count({ where: { wonTaskStatusId: sourceId } }),
  ]);

  /**
   * `closedAt` segue lo stato. Riaprire azzera la data; chiudere la scrive, ma
   * **solo dove manca** — una data di chiusura che c'era già è un fatto, e
   * riscriverla a oggi sposterebbe il task nei conteggi di questa settimana.
   * Il secondo caso non entra in questo `updateMany`, che scriverebbe a tutti.
   */
  const reopening = source.isClosed && !target.isClosed ? { closedAt: null } : {};
  const moved = flagsToMove(source, target);

  /**
   * Una transazione sola, dallo spostamento alla cancellazione — e prima di
   * cancellare, una rete: la FK di `Task.statusId` è `ON DELETE SET NULL`,
   * quindi un task entrato nello stato di partenza **mentre** la fusione
   * girava non farebbe fallire niente — resterebbe **senza stato**, in
   * silenzio, cioè senza area e invisibile a ogni bacheca. L'`updateMany`
   * finale per `statusId` (non per id) raccoglie anche quelli, cestino
   * compreso: l'estensione del filtro tocca solo le letture.
   *
   * L'ordine non è negoziabile: task e riferimenti prima (ricorrenze e fasi
   * vinte sono `SetNull` anche loro), i contrassegni poi, la cancellazione per
   * ultima.
   */
  await prisma.$transaction([
    prisma.task.updateMany({
      where: { id: { in: all } },
      data: { statusId: targetId, ...reopening },
    }),
    // Lo storico, una riga per task: da dove viene, dove è andato, e che è
    // stata una fusione e non una mano sul singolo record.
    prisma.activityLog.createMany({
      data: all.map((taskId) => ({
        taskId,
        userId: user.id,
        action: MERGE_ACTION,
        payload: JSON.stringify({ from: source.name, to: target.name }),
      })),
    }),
    prisma.recurrenceTemplate.updateMany({
      where: { initialStatusId: sourceId },
      data: { initialStatusId: targetId },
    }),
    prisma.dealStage.updateMany({
      where: { wonTaskStatusId: sourceId },
      data: { wonTaskStatusId: targetId },
    }),
    // La rete: chiunque sia arrivato nello stato di partenza dopo la lettura
    // degli id. Niente riga di storico per loro — non c'è un id da citare — ma
    // nemmeno un task senza area.
    prisma.task.updateMany({
      where: { statusId: sourceId },
      data: { statusId: targetId, ...reopening },
    }),
    ...(moved.labels.length > 0
      ? [prisma.taskStatus.update({ where: { id: targetId }, data: moved.data })]
      : []),
    prisma.taskStatus.delete({ where: { id: sourceId } }),
  ]);

  // La chiusura in massa non si può fare nello stesso `updateMany`: la data va
  // messa solo ai task che non ce l'hanno già.
  if (target.isClosed && !source.isClosed) {
    await prisma.task.updateMany({
      where: { id: { in: all }, closedAt: null },
      data: { closedAt: now },
    });
  }

  return {
    migrated: ids.active.length,
    trashed: ids.trashed.length,
    recurrences,
    dealStages,
    deleted: source.name,
    flagsMoved: moved.labels,
  };
}
