// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **L'automazione dell'offerta vinta**, in un modulo suo perché la chiamano in
 * due: la rotta che sposta l'offerta in fase vinta quando il modello è spento,
 * e la lettura degli allegati quando finisce senza trovare attività tecniche —
 * cioè quando non c'è niente da far decidere a nessuno (04/09/2026).
 */
import { ActivityCategory, NotificationType, TaskKind, appendNote } from "@kancrm/shared";
import { prisma, prismaRaw } from "../../db";
import { logActivity } from "../tasks/activity";
import { notify } from "../notifications/service";
import { requireInitialStatusId } from "../task-statuses/service";
import { sanitizeRichText } from "../rich-text/sanitize";

/**
 * Chi possiede l'offerta: il commerciale assegnato o, se non c'è, chi l'ha
 * creata. Resta supervisore del task che ne nasce.
 */
function ownerIdOf(deal: { assigneeId: string | null; creatorId: string }): string {
  return deal.assigneeId ?? deal.creatorId;
}

/**
 * Automazione offerta vinta (vedi CLAUDE.md): quando un'offerta entra in una fase
 * `isWon` nasce un task per l'amministrazione con lo stesso titolo, la stessa
 * descrizione e gli stessi allegati (condivisi dalla tabella ponte, i file non
 * vengono duplicati), scadenza a oggi.
 *
 * Chi lo lavora: il commerciale resta **supervisore**, e l'assegnatario è
 * l'amministrativo di riferimento del commerciale (`User.billingAssignee`); se
 * non è configurato il task resta libero e lo prende chi se ne occupa.
 *
 * Lo stato iniziale è quello contrassegnato nella pagina Stati ("task da offerta
 * vinta", es. "Fatture da emettere"): l'amministrazione lo smista poi da lì.
 *
 * Idempotente: `Task.sourceDealId` è unico, il task non viene mai ricreato — né
 * ripassando dalla stessa fase né passando a un'altra fase vinta.
 */
export async function ensureWonDealTask(
  dealId: string,
  // Serve solo l'id: chi crea il task e chi firma la voce di storico.
  user: { id: string },
  note?: string | null,
): Promise<string | null> {
  // Client raw: se il task è nel cestino non va ricreato.
  const existing = await prismaRaw.task.findUnique({ where: { sourceDealId: dealId } });
  if (existing) return null;

  const deal = await prisma.task.findUniqueOrThrow({
    where: { id: dealId },
    include: { attachments: true, dealStage: true },
  });

  // Stato del task: quello configurato sulla fase vinta ha la precedenza; in mancanza
  // lo stato ADMIN contrassegnato isWonTarget; in ultima istanza il primo ADMIN.
  const target = await prisma.taskStatus.findFirst({
    where: { category: ActivityCategory.ADMIN, isWonTarget: true },
  });
  const statusId =
    deal.dealStage?.wonTaskStatusId ??
    target?.id ??
    (await requireInitialStatusId(ActivityCategory.ADMIN));

  // Il commerciale dell'offerta (o chi l'ha creata) supervisiona; se ne occupa
  // l'amministrativo configurato sulla fase, altrimenti quello di riferimento del
  // commerciale (User.billingAssignee).
  const ownerId = ownerIdOf(deal);
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  const assigneeId = deal.dealStage?.wonTaskAssigneeId ?? owner?.billingAssigneeId ?? null;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const wonTask = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        kind: TaskKind.ADMIN,
        title: deal.title,
        // La nota del commerciale va in coda alla descrizione, dopo una riga:
        // il contratto si legge per primo, il commento viene dopo.
        description: note?.trim()
          ? sanitizeRichText(appendNote(deal.description, note))
          : deal.description,
        statusId,
        creatorId: user.id,
        assigneeId,
        supervisorId: ownerId,
        dueDate: today,
        sourceDealId: dealId,
        attachments: {
          create: deal.attachments.map((ta) => ({ attachmentId: ta.attachmentId })),
        },
        activities: { create: { userId: user.id, action: "created" } },
      },
    });
    await logActivity(tx, dealId, user.id, "billing_task_created", { taskId: created.id });
    return created;
  });

  // Notifica al solo amministrativo assegnato: è chi deve muoversi.
  if (assigneeId) {
    await notify(assigneeId, user.id, NotificationType.TASK_ASSIGNED, {
      message: (t) => t('Offerta vinta da fatturare: "{{title}}"', { title: deal.title }),
      taskId: wonTask.id,
      // Il task generato è amministrativo: si apre nello scadenzario, non
      // nell'offerta da cui nasce.
      taskKind: TaskKind.ADMIN,
    });
  }
  return wonTask.id;
}
