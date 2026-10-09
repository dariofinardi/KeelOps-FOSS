import { prismaRaw, type TxClient } from "../../db";
import type { User } from "../../generated/prisma/client";

/**
 * Migrazione/unione di utenti da CLI (vedi scripts/migrate-user.ts).
 *
 * - **rename**: cambia l'email di un utente (quando la destinazione non esiste).
 * - **merge**: sposta TUTTI i dati di un utente su un altro (quando la
 *   destinazione esiste già) e poi elimina l'origine — così due record della
 *   stessa persona diventano uno.
 *
 * A differenza dell'eliminazione utente ([[deletion]]), qui le **ore a timesheet
 * seguono la destinazione** (sommate in caso di conflitto), non l'utente Archivio:
 * è una fusione di identità, non una rimozione. Usa `prismaRaw` per raggiungere
 * anche i record nel cestino, altrimenti resterebbero a puntare all'utente
 * eliminato e la delete finale fallirebbe per foreign key.
 */

export interface MergeCounts {
  tasksCreator: number;
  tasksAssignee: number;
  tasksSupervisor: number;
  comments: number;
  activities: number;
  attachments: number;
  crmNotes: number;
  recurrences: number;
  timesheetLocks: number;
  billingRefs: number;
  projectMemberships: number;
  timeEntriesMoved: number;
  timeEntriesMerged: number;
  notifications: number;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return prismaRaw.user.findUnique({ where: { email: email.toLowerCase().trim() } });
}

/** Rinomina l'email di un utente (la destinazione non deve esistere). */
export async function renameUser(fromId: string, newEmail: string): Promise<void> {
  await prismaRaw.user.update({
    where: { id: fromId },
    data: { email: newEmail.toLowerCase().trim() },
  });
}

/**
 * Fonde `from` in `to`: riassegna ogni riferimento, somma le ore in conflitto,
 * poi elimina `from`. Ritorna i conteggi di ciò che è stato spostato.
 */
export async function mergeUser(from: User, to: User): Promise<MergeCounts> {
  if (from.id === to.id) throw new Error("Origine e destinazione coincidono");
  if (to.isSystem) throw new Error("La destinazione non può essere un utente di sistema");

  const counts: MergeCounts = {
    tasksCreator: 0,
    tasksAssignee: 0,
    tasksSupervisor: 0,
    comments: 0,
    activities: 0,
    attachments: 0,
    crmNotes: 0,
    recurrences: 0,
    timesheetLocks: 0,
    billingRefs: 0,
    projectMemberships: 0,
    timeEntriesMoved: 0,
    timeEntriesMerged: 0,
    notifications: 0,
  };

  await prismaRaw.$transaction(async (tx: TxClient) => {
    counts.tasksCreator = (
      await tx.task.updateMany({ where: { creatorId: from.id }, data: { creatorId: to.id } })
    ).count;
    counts.tasksAssignee = (
      await tx.task.updateMany({ where: { assigneeId: from.id }, data: { assigneeId: to.id } })
    ).count;
    counts.tasksSupervisor = (
      await tx.task.updateMany({
        where: { supervisorId: from.id },
        data: { supervisorId: to.id },
      })
    ).count;
    counts.comments = (
      await tx.comment.updateMany({ where: { authorId: from.id }, data: { authorId: to.id } })
    ).count;
    counts.activities = (
      await tx.activityLog.updateMany({ where: { userId: from.id }, data: { userId: to.id } })
    ).count;
    counts.attachments = (
      await tx.attachment.updateMany({
        where: { uploadedById: from.id },
        data: { uploadedById: to.id },
      })
    ).count;
    counts.crmNotes = (
      await tx.crmNote.updateMany({ where: { authorId: from.id }, data: { authorId: to.id } })
    ).count;
    for (const field of ["creatorId", "assigneeId", "supervisorId"] as const) {
      counts.recurrences += (
        await tx.recurrenceTemplate.updateMany({
          where: { [field]: from.id },
          data: { [field]: to.id },
        })
      ).count;
    }
    counts.timesheetLocks = (
      await tx.timesheetLock.updateMany({
        where: { lockedById: from.id },
        data: { lockedById: to.id },
      })
    ).count;
    // Chiavi RESTRICT dei moduli: senza, la fusione falliva sull'eliminazione
    // finale (08/10/2026). Non hanno un contatore: il riepilogo resta com'era.
    await tx.dealAnalysis.updateMany({
      where: { requestedById: from.id },
      data: { requestedById: to.id },
    });
    await tx.injectClient.updateMany({
      where: { serviceUserId: from.id },
      data: { serviceUserId: to.id },
    });
    counts.billingRefs = (
      await tx.user.updateMany({
        where: { billingAssigneeId: from.id },
        data: { billingAssigneeId: to.id },
      })
    ).count;

    // Appartenenze ai progetti: mantieni il ruolo di `to` se già membro.
    const memberships = await tx.projectMember.findMany({ where: { userId: from.id } });
    for (const membership of memberships) {
      const already = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId: membership.projectId, userId: to.id } },
      });
      if (!already) {
        await tx.projectMember.create({
          data: { projectId: membership.projectId, userId: to.id, role: membership.role },
        });
        counts.projectMemberships += 1;
      }
      await tx.projectMember.delete({
        where: { projectId_userId: { projectId: membership.projectId, userId: from.id } },
      });
    }

    // Ore a timesheet: somma su conflitto (stessa persona, task, giorno).
    const entries = await tx.timeEntry.findMany({ where: { userId: from.id } });
    for (const entry of entries) {
      const clash = await tx.timeEntry.findUnique({
        where: {
          userId_taskId_date: { userId: to.id, taskId: entry.taskId, date: entry.date },
        },
      });
      if (clash) {
        await tx.timeEntry.update({
          where: { id: clash.id },
          data: {
            hours: clash.hours + entry.hours,
            note: [clash.note, entry.note].filter(Boolean).join(" · ").slice(0, 500) || null,
          },
        });
        await tx.timeEntry.delete({ where: { id: entry.id } });
        counts.timeEntriesMerged += 1;
      } else {
        await tx.timeEntry.update({ where: { id: entry.id }, data: { userId: to.id } });
        counts.timeEntriesMoved += 1;
      }
    }

    // Notifiche: spostabili. Preferenze/push/sessioni sono dati personali: si
    // eliminano con l'utente (evita conflitti sui vincoli unici della destinazione).
    counts.notifications = (
      await tx.notification.updateMany({ where: { userId: from.id }, data: { userId: to.id } })
    ).count;
    await tx.notificationPreference.deleteMany({ where: { userId: from.id } });
    await tx.pushSubscription.deleteMany({ where: { userId: from.id } });
    await tx.session.deleteMany({ where: { userId: from.id } });
    await tx.groupMember.deleteMany({ where: { userId: from.id } });

    await tx.user.delete({ where: { id: from.id } });
  });

  return counts;
}
