// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TaskKind, type CreateDealInput } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest } from "../../lib/http-errors";
import { logActivity } from "../tasks/activity";
import { requireInitialStatusId, statusCategoryOfTask } from "../task-statuses/service";

/** Il client della transazione di `prisma` (quello con le estensioni, non il grezzo). */
type Transazione = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * **La nascita di un'offerta**, in un posto solo (06/10/2026): la usano la
 * creazione dalla pagina Offerte e quella da un task. Le regole: senza fase si
 * parte dalla prima della pipeline; un'offerta che nasce vinta o persa è chiusa
 * oggi, e se è vinta vale il 100% (la previsione la conta per intero, il campo
 * deve dire lo stesso).
 *
 * `poi` gira nella stessa transazione, dopo la creazione: chi crea da un task ci
 * aggiunge il link e le voci di cronologia, e o si salva tutto o niente.
 */
export async function creaOfferta(
  input: CreateDealInput,
  user: { id: string },
  poi?: (tx: Transazione, offerta: { id: string }) => Promise<void>,
): Promise<{ id: string; vinta: boolean }> {
  const fase = input.stageId
    ? await prisma.dealStage.findUnique({ where: { id: input.stageId } })
    : await prisma.dealStage.findFirst({ orderBy: { order: "asc" } });
  if (!fase)
    throw badRequest(input.stageId ? "Fase non valida" : "Nessuna fase pipeline configurata");
  const chiusa = fase.isWon || fase.isLost;
  // Le offerte usano gli stati del proprio modulo (commerciali), come ogni task.
  const statusId = await requireInitialStatusId(
    await statusCategoryOfTask({ kind: TaskKind.DEAL }),
  );

  const creata = await prisma.$transaction(async (tx) => {
    const offerta = await tx.task.create({
      data: {
        kind: TaskKind.DEAL,
        title: input.title,
        description: input.description ?? null,
        statusId,
        creatorId: user.id,
        assigneeId: input.assigneeId ?? null,
        dealStageId: fase.id,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        dealValue: input.dealValue ?? null,
        // un'offerta vinta è certa: 100%, qualunque cosa dicesse la stima
        probability: fase.isWon ? 100 : (input.probability ?? null),
        expectedCloseDate: input.expectedCloseDate
          ? new Date(`${input.expectedCloseDate}T00:00:00.000Z`)
          : null,
        visibleToSalesMonitors: input.visibleToSalesMonitors ?? false,
        closedAt: chiusa ? new Date() : null,
      },
    });
    await logActivity(tx, offerta.id, user.id, "created");
    if (poi) await poi(tx, offerta);
    return offerta;
  });
  return { id: creata.id, vinta: fase.isWon };
}
