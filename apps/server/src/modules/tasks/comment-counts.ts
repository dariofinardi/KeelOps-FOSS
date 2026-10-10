// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "../../db";
import { messaggiVisibiliA, staFuori } from "./comment-visibility";

/**
 * **Quanti messaggi vede chi guarda**, per un gruppo di task.
 *
 * Il conteggio che arriva con gli elenchi (`_count.comments`) li conta tutti:
 * per un interno è giusto, per chi sta fuori no — «3» accanto al fumetto e
 * due messaggi nella chat vorrebbe dire rivelare quello riservato
 * (16/09/2026). Per un interno restituisce `null`: il conteggio che c'è già
 * vale, e non serve una seconda lettura.
 */
export async function contaMessaggiVisibili(
  user: { id: string; role: string },
  taskIds: string[],
): Promise<Map<string, number> | null> {
  if (!staFuori(user)) return null;
  const conteggi = new Map(taskIds.map((id) => [id, 0]));
  if (taskIds.length === 0) return conteggi;
  const righe = await prisma.comment.groupBy({
    by: ["taskId"],
    where: { AND: [{ taskId: { in: taskIds } }, messaggiVisibiliA(user)] },
    _count: { _all: true },
  });
  for (const riga of righe) conteggi.set(riga.taskId, riga._count._all);
  return conteggi;
}

/**
 * Gli allegati arrivati con un messaggio che chi guarda non vede: per chi sta
 * fuori non esistono. Un file mandato in un messaggio riservato agli interni
 * è riservato quanto il messaggio — lasciarlo negli allegati della richiesta
 * vorrebbe dire aver nascosto la frase e mostrato il documento.
 */
export async function allegatiNascostiA(
  user: { id: string; role: string },
  attachmentIds: string[],
): Promise<Set<string>> {
  if (!staFuori(user) || attachmentIds.length === 0) return new Set();
  const legami = await prisma.commentAttachment.findMany({
    where: {
      attachmentId: { in: attachmentIds },
      comment: { NOT: messaggiVisibiliA(user) },
    },
    select: { attachmentId: true },
  });
  return new Set(legami.map((legame) => legame.attachmentId));
}

/**
 * Il dettaglio di un task **come lo vede chi sta fuori**: il numero dei
 * messaggi è quello dei visibili, e gli allegati arrivati con un messaggio
 * nascosto non ci sono. Per un interno il dettaglio esce com'è. Serve a ogni
 * rotta che serve un dettaglio a qualcuno che può stare fuori — la richiesta
 * vista dal portale, lo stesso task aperto dalla rotta dei task.
 */
export async function dettaglioPerChiGuarda<
  D extends { id: string; commentCount: number; attachments: Array<{ id: string }> },
>(user: { id: string; role: string }, dettaglio: D): Promise<D> {
  if (!staFuori(user)) return dettaglio;
  const [conteggi, nascosti] = await Promise.all([
    contaMessaggiVisibili(user, [dettaglio.id]),
    allegatiNascostiA(
      user,
      dettaglio.attachments.map((allegato) => allegato.id),
    ),
  ]);
  return {
    ...dettaglio,
    commentCount: conteggi?.get(dettaglio.id) ?? dettaglio.commentCount,
    attachments: dettaglio.attachments.filter((allegato) => !nascosti.has(allegato.id)),
  };
}
