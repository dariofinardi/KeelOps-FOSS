// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import path from "node:path";
import { AttachmentType } from "@kancrm/shared";
import { config } from "../../config";
import { prisma } from "../../db";
import { attachmentStore } from "./store";

export function attachmentAbsolutePath(relativePath: string): string {
  const base = path.resolve(config.uploadsDir);
  const absolute = path.resolve(base, relativePath);
  // Difesa da path traversal: il path deve restare DENTRO uploadsDir. Con
  // path.relative si esclude sia la risalita (`..`) sia una cartella sorella
  // che condivide il prefisso (`/uploads-altro`), che uno startsWith accettava.
  const rel = path.relative(base, absolute);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error("Percorso allegato non valido");
  }
  return absolute;
}

export function sanitizeFilename(name: string): string {
  const base = path
    .basename(name)
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("");
  return base.length > 0 ? base.slice(0, 150) : "allegato";
}

/**
 * Elimina gli Attachment (record + file su disco) non più collegati ad alcun
 * task NÉ ad alcun template di ricorrenza NÉ a una nota di rilascio di progetto. Gli allegati condivisi tramite la
 * tabella ponte (deal→task fattura, M4) o ancora usati da un modello restano.
 */
export async function removeOrphanAttachmentFiles(attachmentIds: string[]): Promise<void> {
  for (const attachmentId of attachmentIds) {
    const onTask = await prisma.taskAttachment.findFirst({ where: { attachmentId } });
    if (onTask) continue;
    const onTemplate = await prisma.recurrenceTemplateAttachment.findFirst({
      where: { attachmentId },
    });
    if (onTemplate) continue;
    const onRelease = await prisma.projectReleaseDocument.findFirst({ where: { attachmentId } });
    if (onRelease) continue;
    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) continue;
    if (attachment.type === AttachmentType.FILE && attachment.path) {
      await attachmentStore().remove(attachment.path);
    }
    await prisma.attachment.delete({ where: { id: attachmentId } }).catch(() => undefined);
  }
}

/**
 * Sweep degli allegati rimasti orfani (nessun link a task o template): ne
 * elimina record e file. Va chiamato solo nei momenti di eliminazione
 * definitiva (svuotamento/purge del cestino), mai su una semplice rimozione da
 * un task — così un file non sparisce finché il suo record non è eliminato per
 * davvero. Ritorna quanti allegati sono stati rimossi.
 */
export async function sweepOrphanAttachments(): Promise<number> {
  const orphans = await prisma.attachment.findMany({
    where: { tasks: { none: {} }, templates: { none: {} }, releaseDocuments: { none: {} } },
    select: { id: true },
  });
  await removeOrphanAttachmentFiles(orphans.map((a) => a.id));
  return orphans.length;
}
