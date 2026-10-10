// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { config } from "../../config";
import { prismaRaw } from "../../db";
import { badRequest, notFound } from "../../lib/http-errors";
import { removeOrphanAttachmentFiles, sweepOrphanAttachments } from "../attachments/storage";
import { removeInlineImages } from "../rich-text/inline-images";

export type TrashType = "task" | "project" | "company" | "contact";

/**
 * Soft delete di un task: il record resta (ore, allegati e commenti inclusi) e
 * i subtask vengono eliminati in cascata CON LO STESSO timestamp, così il
 * ripristino del padre riporta solo i figli eliminati insieme a lui.
 */
export async function softDeleteTask(taskId: string, when = new Date()): Promise<void> {
  await prismaRaw.task.update({ where: { id: taskId }, data: { deletedAt: when } });
  await prismaRaw.task.updateMany({
    where: { parentTaskId: taskId, deletedAt: null },
    data: { deletedAt: when },
  });
}

/** Soft delete di un progetto: in cascata tutti i suoi task (e subtask). */
export async function softDeleteProject(projectId: string, when = new Date()): Promise<void> {
  await prismaRaw.project.update({ where: { id: projectId }, data: { deletedAt: when } });
  await prismaRaw.task.updateMany({
    where: { projectId, deletedAt: null },
    data: { deletedAt: when },
  });
}

export async function softDeleteCompany(companyId: string, when = new Date()): Promise<void> {
  // Nessuna cascata: contatti e offerte restano attivi e mostrano "(eliminata)".
  await prismaRaw.company.update({ where: { id: companyId }, data: { deletedAt: when } });
}

export async function softDeleteContact(contactId: string, when = new Date()): Promise<void> {
  await prismaRaw.contact.update({ where: { id: contactId }, data: { deletedAt: when } });
}

export async function restore(type: TrashType, id: string): Promise<void> {
  if (type === "task") {
    const task = await prismaRaw.task.findUnique({ where: { id } });
    if (!task?.deletedAt) throw notFound("Elemento non trovato nel cestino");
    // Non si ripristina un figlio se il contenitore è ancora nel cestino.
    if (task.parentTaskId) {
      const parent = await prismaRaw.task.findUnique({ where: { id: task.parentTaskId } });
      if (parent?.deletedAt) {
        throw badRequest("Ripristina prima il task padre (è nel cestino)");
      }
    }
    if (task.projectId) {
      const project = await prismaRaw.project.findUnique({ where: { id: task.projectId } });
      if (project?.deletedAt) {
        throw badRequest("Ripristina prima il progetto (è nel cestino)");
      }
    }
    await prismaRaw.task.update({ where: { id }, data: { deletedAt: null } });
    // Ripristina i subtask eliminati nella stessa cascata (stesso timestamp).
    await prismaRaw.task.updateMany({
      where: { parentTaskId: id, deletedAt: task.deletedAt },
      data: { deletedAt: null },
    });
    return;
  }
  if (type === "project") {
    const project = await prismaRaw.project.findUnique({ where: { id } });
    if (!project?.deletedAt) throw notFound("Elemento non trovato nel cestino");
    await prismaRaw.project.update({ where: { id }, data: { deletedAt: null } });
    await prismaRaw.task.updateMany({
      where: { projectId: id, deletedAt: project.deletedAt },
      data: { deletedAt: null },
    });
    return;
  }
  if (type === "company") {
    const company = await prismaRaw.company.findUnique({ where: { id } });
    if (!company?.deletedAt) throw notFound("Elemento non trovato nel cestino");
    await prismaRaw.company.update({ where: { id }, data: { deletedAt: null } });
    return;
  }
  const contact = await prismaRaw.contact.findUnique({ where: { id } });
  if (!contact?.deletedAt) throw notFound("Elemento non trovato nel cestino");
  await prismaRaw.contact.update({ where: { id }, data: { deletedAt: null } });
}

/** Eliminazione DEFINITIVA di un task: cascata db + pulizia file allegati orfani. */
export async function hardDeleteTask(taskId: string): Promise<void> {
  const links = await prismaRaw.taskAttachment.findMany({ where: { taskId } });
  await prismaRaw.task.delete({ where: { id: taskId } }); // cascata subtask/commenti/ore
  await removeOrphanAttachmentFiles(links.map((l) => l.attachmentId));
  // Le figure incollate nella descrizione non hanno un record da cui cadere:
  // il loro unico riferimento era il testo, che ora non c'è più. Senza questo
  // restavano nel magazzino per sempre — ed erano la sola via da cui nascevano
  // orfani veri (20/08/2026).
  await removeInlineImages(taskId);
}

export async function hardDelete(type: TrashType, id: string): Promise<void> {
  if (type === "task") {
    const task = await prismaRaw.task.findUnique({ where: { id } });
    if (!task?.deletedAt) throw notFound("Elemento non trovato nel cestino");
    await hardDeleteTask(id);
    return;
  }
  if (type === "project") {
    const project = await prismaRaw.project.findUnique({ where: { id } });
    if (!project?.deletedAt) throw notFound("Elemento non trovato nel cestino");
    const links = await prismaRaw.taskAttachment.findMany({
      where: { task: { projectId: id } },
    });
    await prismaRaw.project.delete({ where: { id } }); // cascata su tutti i task
    await removeOrphanAttachmentFiles(links.map((l) => l.attachmentId));
    return;
  }
  if (type === "company") {
    const company = await prismaRaw.company.findUnique({ where: { id } });
    if (!company?.deletedAt) throw notFound("Elemento non trovato nel cestino");
    await prismaRaw.company.delete({ where: { id } });
    return;
  }
  const contact = await prismaRaw.contact.findUnique({ where: { id } });
  if (!contact?.deletedAt) throw notFound("Elemento non trovato nel cestino");
  await prismaRaw.contact.delete({ where: { id } });
}

/** Purge automatico: elimina definitivamente ciò che è nel cestino da troppo tempo. */
export async function purgeTrash(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - config.trashRetentionDays * 24 * 60 * 60 * 1000);
  return purgeDeleted(cutoff);
}

/** Svuotamento manuale: elimina definitivamente tutto ciò che è nel cestino. */
export async function emptyTrash(): Promise<number> {
  return purgeDeleted(null);
}

/**
 * Eliminazione definitiva degli elementi nel cestino: tutti, o solo quelli
 * eliminati prima di `cutoff`. Prima i task sciolti, poi i progetti (che si
 * portano dietro i propri task), infine anagrafiche; i file degli allegati
 * rimasti orfani vengono cancellati dal disco.
 */
async function purgeDeleted(cutoff: Date | null): Promise<number> {
  const olderThan = cutoff ? { not: null, lt: cutoff } : { not: null };
  let purged = 0;

  // Prima i task sciolti (quelli dei progetti cadono con il progetto).
  const tasks = await prismaRaw.task.findMany({
    where: { deletedAt: olderThan },
    select: { id: true },
  });
  for (const task of tasks) {
    // Il padre potrebbe essere già caduto in cascata in questo stesso ciclo.
    const stillThere = await prismaRaw.task.findUnique({ where: { id: task.id } });
    if (!stillThere) continue;
    await hardDeleteTask(task.id);
    purged += 1;
  }
  const projects = await prismaRaw.project.findMany({
    where: { deletedAt: olderThan },
    select: { id: true },
  });
  for (const project of projects) {
    const links = await prismaRaw.taskAttachment.findMany({
      where: { task: { projectId: project.id } },
    });
    await prismaRaw.project.delete({ where: { id: project.id } });
    await removeOrphanAttachmentFiles(links.map((l) => l.attachmentId));
    purged += 1;
  }
  const companies = await prismaRaw.company.deleteMany({ where: { deletedAt: olderThan } });
  const contacts = await prismaRaw.contact.deleteMany({ where: { deletedAt: olderThan } });

  // Momento di eliminazione definitiva: raccogli anche gli allegati rimasti
  // orfani (es. staccati da un task senza essere ricollegati altrove).
  await sweepOrphanAttachments();

  return purged + companies.count + contacts.count;
}
