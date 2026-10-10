// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { UserRole, type UserDeletionImpact } from "@kancrm/shared";
import { prismaRaw, type TxClient } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/http-errors";
import type { Prisma, User } from "../../generated/prisma/client";

/**
 * Eliminazione di un utente.
 *
 * Un utente non si può semplicemente cancellare: task, commenti, allegati e log
 * lo referenziano con chiavi obbligatorie. Quindi:
 *
 *  - utente senza alcun dato collegato → eliminato direttamente;
 *  - utente con dati → l'admin indica a chi trasferirli (`transferTo`), e solo
 *    dopo il trasferimento l'utente viene eliminato.
 *
 * Le **ore a timesheet fanno eccezione**: non vengono intestate al collega, che
 * si ritroverebbe ore mai lavorate nei propri totali, ma all'utente di sistema
 * "Archivio", con il nome del vecchio utente aggiunto nella nota. I totali
 * aziendali dei mesi già chiusi restano così invariati e restano leggibili.
 */

export const ARCHIVE_USER_EMAIL = "archivio@kancrm.local";
const ARCHIVE_USER_NAME = "Archivio (utenti eliminati)";

/** Lunghezza massima della nota di una registrazione (vedi upsertTimeEntrySchema). */
const NOTE_MAX = 500;

/**
 * Utente di sistema che eredita le ore dei collaboratori eliminati. Creato al
 * primo utilizzo: senza password e disattivato, quindi non può accedere né
 * comparire tra gli assegnatari selezionabili.
 */
export async function ensureArchiveUser(): Promise<User> {
  const existing = await prismaRaw.user.findUnique({ where: { email: ARCHIVE_USER_EMAIL } });
  if (existing) return existing;
  return prismaRaw.user.create({
    data: {
      email: ARCHIVE_USER_EMAIL,
      name: ARCHIVE_USER_NAME,
      role: UserRole.MEMBER,
      isActive: false,
      isSystem: true,
    },
  });
}

/**
 * Dati che l'eliminazione dell'utente andrebbe a toccare. Client raw ovunque:
 * anche un task nel cestino referenzia l'utente e impedirebbe l'eliminazione,
 * quindi va contato e trasferito come gli altri.
 */
export async function userDeletionImpact(userId: string): Promise<UserDeletionImpact> {
  const ownTask: Prisma.TaskWhereInput = {
    OR: [{ creatorId: userId }, { assigneeId: userId }, { supervisorId: userId }],
  };
  const [tasks, deals, comments, hours, recurrences, projects, notes, activities, analyses] =
    await Promise.all([
      prismaRaw.task.count({ where: { ...ownTask, kind: { not: "DEAL" } } }),
      prismaRaw.task.count({ where: { ...ownTask, kind: "DEAL" } }),
      prismaRaw.comment.count({ where: { authorId: userId } }),
      prismaRaw.timeEntry.aggregate({ where: { userId }, _sum: { hours: true } }),
      prismaRaw.recurrenceTemplate.count({
        where: {
          OR: [{ creatorId: userId }, { assigneeId: userId }, { supervisorId: userId }],
        },
      }),
      prismaRaw.projectMember.count({ where: { userId } }),
      prismaRaw.crmNote.count({ where: { authorId: userId } }),
      prismaRaw.activityLog.count({ where: { userId } }),
      prismaRaw.dealAnalysis.count({ where: { requestedById: userId } }),
    ]);

  const counts = {
    tasks,
    deals,
    comments,
    hours: hours._sum.hours ?? 0,
    recurrences,
    projects,
    notes,
    activities,
  };
  // Le analisi delle offerte vinte non hanno una voce loro nel riepilogo (stanno
  // con le offerte), ma sono dati: senza destinatario la loro chiave bloccherebbe
  // l'eliminazione (08/10/2026).
  return { counts, hasData: analyses > 0 || Object.values(counts).some((value) => value > 0) };
}

/** Nota della registrazione con l'intestatario originale, entro il limite di lunghezza. */
function noteWithOwner(note: string | null, ownerName: string): string {
  const suffix = `ore di ${ownerName}`;
  const merged = note ? `${note} — ${suffix}` : `Ore di ${ownerName}`;
  return merged.slice(0, NOTE_MAX);
}

/**
 * Sposta le ore dell'utente sull'utente Archivio. Se Archivio ha già una
 * registrazione per lo stesso task e giorno (secondo collaboratore eliminato che
 * ha lavorato lo stesso giorno sullo stesso task) le due righe vengono sommate:
 * il vincolo unico (utente, task, giorno) non ammette duplicati.
 */
async function moveTimeEntriesToArchive(
  tx: TxClient,
  user: User,
  archiveId: string,
): Promise<void> {
  const entries = await tx.timeEntry.findMany({ where: { userId: user.id } });
  for (const entry of entries) {
    const note = noteWithOwner(entry.note, user.name);
    const existing = await tx.timeEntry.findUnique({
      where: {
        userId_taskId_date: { userId: archiveId, taskId: entry.taskId, date: entry.date },
      },
    });
    if (existing) {
      await tx.timeEntry.update({
        where: { id: existing.id },
        data: {
          hours: existing.hours + entry.hours,
          note: [existing.note, note].filter(Boolean).join(" · ").slice(0, NOTE_MAX),
        },
      });
      await tx.timeEntry.delete({ where: { id: entry.id } });
    } else {
      await tx.timeEntry.update({ where: { id: entry.id }, data: { userId: archiveId, note } });
    }
  }
}

/**
 * Trasferisce le appartenenze ai progetti: se il destinatario è già membro
 * mantiene il proprio ruolo, altrimenti eredita quello dell'utente eliminato —
 * così un progetto non resta senza manager.
 */
async function transferProjectMemberships(
  tx: TxClient,
  userId: string,
  transferToId: string,
): Promise<void> {
  const memberships = await tx.projectMember.findMany({ where: { userId } });
  for (const membership of memberships) {
    const already = await tx.projectMember.findUnique({
      where: {
        projectId_userId: { projectId: membership.projectId, userId: transferToId },
      },
    });
    if (already) continue;
    await tx.projectMember.create({
      data: {
        projectId: membership.projectId,
        userId: transferToId,
        role: membership.role,
      },
    });
  }
}

async function assertDeletable(user: User, currentUserId: string): Promise<void> {
  if (user.id === currentUserId) throw badRequest("Non puoi eliminare il tuo stesso account");
  if (user.isSystem) throw badRequest("L'utente di sistema non è eliminabile");
  /**
   * L'utente a nome del quale un modulo iniettabile apre le richieste: la sua
   * chiave è RESTRICT per scelta (senza, il modulo smetterebbe di funzionare in
   * silenzio). Prima l'eliminazione finiva in un errore del database; ora dice
   * quale modulo cambiare (08/10/2026).
   */
  const modulo = await prismaRaw.injectClient.findFirst({
    where: { serviceUserId: user.id },
    select: { name: true },
  });
  if (modulo) {
    throw conflict(
      "È l'utente di servizio del modulo «{{name}}»: sceglierne un altro nel modulo prima di eliminarlo",
      "SERVICE_USER",
      { name: modulo.name },
    );
  }
  if (user.role === UserRole.ADMIN) {
    const otherAdmins = await prismaRaw.user.count({
      where: { role: UserRole.ADMIN, isActive: true, id: { not: user.id } },
    });
    if (otherAdmins === 0) throw badRequest("Deve restare almeno un amministratore attivo");
  }
}

async function loadTransferTarget(transferToId: string, userId: string): Promise<User> {
  if (transferToId === userId) {
    throw badRequest("Il destinatario del trasferimento deve essere un altro utente");
  }
  const target = await prismaRaw.user.findUnique({ where: { id: transferToId } });
  if (!target) throw badRequest("Utente destinatario non valido");
  if (!target.isActive || target.isSystem) {
    throw badRequest("Il destinatario deve essere un utente attivo");
  }
  // Un cliente del portale vedrebbe task e offerte interne che gli verrebbero intestate.
  if (target.role === UserRole.PORTAL) {
    throw badRequest("Il destinatario non può essere un utente del portale");
  }
  return target;
}

/**
 * Elimina l'utente, trasferendo i dati collegati a `transferToId`. Senza
 * destinatario l'eliminazione riesce solo se l'utente non ha dati (409
 * `TRANSFER_REQUIRED` altrimenti): la UI chiede a chi trasferire e ritenta.
 */
export async function deleteUser(
  userId: string,
  currentUserId: string,
  transferToId: string | null,
): Promise<void> {
  const user = await prismaRaw.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("Utente non trovato");
  await assertDeletable(user, currentUserId);

  const impact = await userDeletionImpact(userId);
  if (!impact.hasData) {
    await prismaRaw.user.delete({ where: { id: userId } });
    return;
  }
  if (!transferToId) {
    throw conflict("L'utente ha dati collegati: indica a chi trasferirli.", "TRANSFER_REQUIRED");
  }
  const target = await loadTransferTarget(transferToId, userId);
  const archive = impact.counts.hours > 0 ? await ensureArchiveUser() : null;

  await prismaRaw.$transaction(async (tx) => {
    if (archive) await moveTimeEntriesToArchive(tx, user, archive.id);
    await transferProjectMemberships(tx, userId, target.id);

    // Storico e titolarità passano al destinatario.
    await tx.task.updateMany({ where: { creatorId: userId }, data: { creatorId: target.id } });
    await tx.task.updateMany({ where: { assigneeId: userId }, data: { assigneeId: target.id } });
    await tx.task.updateMany({
      where: { supervisorId: userId },
      data: { supervisorId: target.id },
    });
    await tx.comment.updateMany({ where: { authorId: userId }, data: { authorId: target.id } });
    await tx.activityLog.updateMany({ where: { userId }, data: { userId: target.id } });
    await tx.attachment.updateMany({
      where: { uploadedById: userId },
      data: { uploadedById: target.id },
    });
    await tx.crmNote.updateMany({ where: { authorId: userId }, data: { authorId: target.id } });
    await tx.recurrenceTemplate.updateMany({
      where: { creatorId: userId },
      data: { creatorId: target.id },
    });
    await tx.recurrenceTemplate.updateMany({
      where: { assigneeId: userId },
      data: { assigneeId: target.id },
    });
    await tx.recurrenceTemplate.updateMany({
      where: { supervisorId: userId },
      data: { supervisorId: target.id },
    });
    await tx.timesheetLock.updateMany({
      where: { lockedById: userId },
      data: { lockedById: target.id },
    });
    // Chiave RESTRICT: senza, l'eliminazione falliva (08/10/2026).
    await tx.dealAnalysis.updateMany({
      where: { requestedById: userId },
      data: { requestedById: target.id },
    });

    // Restano solo i dati personali (sessioni, notifiche, preferenze, iscrizioni
    // push, appartenenze a gruppi e progetti): li elimina la cascata del db.
    await tx.user.delete({ where: { id: userId } });
  });
}
