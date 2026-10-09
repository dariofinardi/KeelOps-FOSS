import { randomUUID } from "node:crypto";
import path from "node:path";
import { AttachmentType } from "@kancrm/shared";
import { prisma } from "../db";
import { config } from "../config";
import { logActivity } from "../modules/tasks/activity";
import { assertAttachmentDownloadAccess } from "../modules/attachments/routes";
import { attachmentStore } from "../modules/attachments/store";
import { sanitizeFilename } from "../modules/attachments/storage";
import { estraiDaByte } from "../modules/attachments/text";
import { evaluateTaskAccess, taskAccessContext } from "../modules/tasks/permissions";

/**
 * **Gli allegati, prestati ai plugin** (richiesta del 05/09/2026: «manda anche
 * i documenti allegati ai task» all'assistente).
 *
 * Un plugin legge il database in sola lettura, ma i file stanno nel magazzino
 * (disco o bucket) e il permesso di aprirli è una regola del core: chi vede il
 * task vede i suoi allegati, con le eccezioni di portale e monitor. Qui il core
 * applica **la stessa regola della rotta di download** e consegna al plugin il
 * testo estratto (PDF e Word con l'estrattore già usato per la lettura delle
 * offerte; i file di testo così come sono) e, se richiesti, i byte — con un
 * tetto: un assistente non ha bisogno di un filmato.
 */
export const TETTO_BYTE = 8 * 1024 * 1024;
const TETTO_TESTO = 200_000;

export interface AllegatoPerPlugin {
  id: string;
  name: string;
  type: string;
  mimeType: string | null;
  size: number | null;
  /** Per i collegamenti (Drive e simili): l'indirizzo, niente contenuto. */
  url: string | null;
  /** Il testo estratto, o null con il motivo in `saltato`. */
  text: string | null;
  saltato: string | null;
  /** I byte, solo se richiesti e sotto il tetto. */
  bytes: Buffer | null;
}

const TESTUALI = /\.(txt|md|csv|json|xml|html?|log|ya?ml|ini|sql|eml)$/i;

export async function leggiAllegatoPerPlugin(
  userId: string,
  attachmentId: string,
  opzioni: { bytes?: boolean } = {},
): Promise<AllegatoPerPlugin> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw new Error("utente non valido");
  const allegato = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!allegato) throw new Error("allegato non trovato");
  await assertAttachmentDownloadAccess(user, attachmentId);

  const base = {
    id: allegato.id,
    name: allegato.name,
    type: allegato.type,
    mimeType: allegato.mimeType,
    size: allegato.size,
    url: allegato.type === AttachmentType.LINK ? allegato.url : null,
  };
  if (allegato.type === AttachmentType.LINK || !allegato.path) {
    return {
      ...base,
      text: null,
      saltato: notaCollegamento(allegato.url),
      bytes: null,
    };
  }
  const dati = await attachmentStore().read(allegato.path);
  const testuale = (allegato.mimeType ?? "").startsWith("text/") || TESTUALI.test(allegato.name);
  let text: string | null = null;
  let saltato: string | null = null;
  if (testuale) {
    text = dati.toString("utf8").slice(0, TETTO_TESTO);
  } else {
    const estratto = await estraiDaByte(allegato.name, allegato.mimeType, dati);
    text = estratto.testo ? estratto.testo.slice(0, TETTO_TESTO) : null;
    saltato = estratto.saltato;
  }
  const bytes = opzioni.bytes && dati.length <= TETTO_BYTE ? dati : null;
  if (opzioni.bytes && dati.length > TETTO_BYTE) {
    saltato = saltato ?? `File oltre gli ${TETTO_BYTE / 1024 / 1024} MB: solo il testo`;
  }
  return { ...base, text, saltato, bytes };
}

/**
 * **Un collegamento non è un file**: KeelOps ne custodisce solo l'indirizzo
 * (per scelta: nessun token Drive lato server). L'assistente lo legge solo se
 * ha il suo connettore verso quel servizio, autorizzato con un account che
 * abbia il permesso sul file — e va detto chiaro, altrimenti «non lo trovo»
 * sembra un difetto nostro (richiesta del 05/09/2026).
 */
export function notaCollegamento(url: string | null): string {
  const drive = /https?:\/\/(drive|docs|sheets|slides)\.google\.com\//i.test(url ?? "");
  return drive
    ? "Collegamento a Google Drive: KeelOps non ha il file, solo l'indirizzo. Si legge SOLO con il connettore Google Drive dell'assistente, autorizzato con un account Google che abbia il permesso su questo file; senza, il contenuto non è raggiungibile e va chiesto a chi lo ha condiviso."
    : "Collegamento esterno: KeelOps non ha il file, solo l'indirizzo. Si legge solo se l'assistente ha un connettore verso quel servizio, autorizzato per accedervi.";
}


/* -------------------------------------------------------------------------- */

/**
 * **Scrivere un allegato, per conto di un plugin** (21/09/2026, per il
 * documento dell'offerta di QuoteDOCX).
 *
 * Il plugin produce un file — un .docx generato, un PDF — e vuole che finisca
 * fra gli allegati del task, visibile a chi lavora l'offerta. Il permesso non
 * è suo: qui vale **la regola del core**, la stessa della rotta di
 * caricamento (chi può modificare il task può allegare), e nella
 * dimostrazione non si scrive comunque nulla.
 *
 * `replaceAttachmentId` sostituisce i byte di un allegato che il plugin ha
 * già creato **su questo task**, tenendo lo stesso id: il collegamento che
 * qualcuno ha in mano continua a valere e la versione nuova prende il posto
 * della vecchia, invece di affiancarla con lo stesso nome. Il file vecchio si
 * toglie dal magazzino dopo, non prima: se la scrittura fallisce si resta con
 * quello di ieri, non senza niente.
 */
export interface AllegatoScritto {
  id: string;
  name: string;
  size: number;
  sostituito: boolean;
}

export async function scriviAllegatoPerPlugin(
  nick: string | null,
  userId: string,
  taskId: string,
  opzioni: {
    name: string;
    mimeType?: string | null;
    bytes: Buffer;
    replaceAttachmentId?: string | null;
    /** Il riferimento del plugin (l'id del documento), per il marchio. */
    ref?: string | null;
  },
): Promise<AllegatoScritto> {
  if (config.demo) throw new Error("Nella dimostrazione non si scrivono allegati.");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw new Error("utente non valido");
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.deletedAt) throw new Error("task non trovato");
  const verdetto = evaluateTaskAccess(await taskAccessContext(user), task);
  if (!verdetto.canEdit) throw new Error("non puoi modificare questo task: l'allegato non è stato scritto");
  if (!opzioni.bytes?.length) throw new Error("nessun byte da scrivere");
  if (opzioni.bytes.length > config.maxUploadMb * 1024 * 1024) {
    throw new Error(`file troppo grande: il limite è ${config.maxUploadMb} MB`);
  }

  const filename = sanitizeFilename(opzioni.name || "documento");
  const relativePath = path.join(taskId, `${randomUUID()}-${filename}`);

  // Sostituzione: dev'essere un allegato DI QUESTO task, non un id qualsiasi.
  let precedente: { id: string; path: string | null } | null = null;
  if (opzioni.replaceAttachmentId) {
    const riga = await prisma.attachment.findFirst({
      where: { id: opzioni.replaceAttachmentId, type: AttachmentType.FILE, tasks: { some: { taskId } } },
      select: { id: true, path: true },
    });
    if (riga) precedente = riga;
  }

  // Il file prima della transazione, come fa la rotta di caricamento: su
  // SQLite l'I/O dentro una transazione tiene il lock di scrittura aperto.
  await attachmentStore().write(relativePath, opzioni.bytes);
  try {
    const esito = await prisma.$transaction(async (tx) => {
      if (precedente) {
        const aggiornato = await tx.attachment.update({
          where: { id: precedente.id },
          data: {
            name: filename,
            mimeType: opzioni.mimeType ?? null,
            size: opzioni.bytes.length,
            path: relativePath,
            // il marchio si riscrive anche sostituendo: la riga è la stessa,
            // ma il file dentro è di nuovo del plugin
            ...(nick ? { pluginNick: nick, pluginRef: opzioni.ref ?? null } : {}),
          },
        });
        await logActivity(tx, taskId, user.id, "attachment_added", { name: filename, type: "FILE", replaced: true });
        return aggiornato;
      }
      const creato = await tx.attachment.create({
        data: {
          type: AttachmentType.FILE,
          name: filename,
          mimeType: opzioni.mimeType ?? null,
          size: opzioni.bytes.length,
          path: relativePath,
          uploadedById: user.id,
          ...(nick ? { pluginNick: nick, pluginRef: opzioni.ref ?? null } : {}),
          tasks: { create: { taskId } },
        },
      });
      await logActivity(tx, taskId, user.id, "attachment_added", { name: filename, type: "FILE" });
      return creato;
    });
    // Il file vecchio se ne va solo ora che il nuovo è registrato.
    if (precedente?.path && precedente.path !== relativePath) {
      await attachmentStore().remove(precedente.path).catch(() => undefined);
    }
    return { id: esito.id, name: esito.name, size: esito.size ?? opzioni.bytes.length, sostituito: Boolean(precedente) };
  } catch (errore) {
    await attachmentStore().remove(relativePath).catch(() => undefined);
    throw errore;
  }
}

/**
 * **Chi può modificare questo task**, con la regola del core: un plugin non
 * la ricopia (`keelops-sdk/perimeter.mjs` risponde su cosa si *vede*, che è
 * un'altra domanda, e in versione prudente). Risposta secca, senza eccezioni
 * da intercettare: un permesso negato non è un guasto.
 */
export async function puoModificareTaskPerPlugin(userId: string, taskId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return false;
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.deletedAt) return false;
  return evaluateTaskAccess(await taskAccessContext(user), task).canEdit;
}
