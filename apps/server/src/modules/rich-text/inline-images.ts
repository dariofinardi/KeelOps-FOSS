// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import path from "node:path";
import { prisma } from "../../db";
import { badRequest } from "../../lib/http-errors";
import { sanitizeFilename } from "../attachments/storage";
import { attachmentStore } from "../attachments/store";

/**
 * Le figure incollate in una descrizione, **anche prima che il record esista**.
 *
 * Il problema (14/08/2026): un browser, quando incolli uno scatto di schermo,
 * ti dà i byte, non un indirizzo — e l'indirizzo serve subito, per mostrarla
 * nell'editor. Finché la figura poteva vivere solo accanto a un task, nel
 * dialogo "nuovo task" non si poteva incollare niente: prima salva, poi
 * incolla, poi risalva.
 *
 * Le due strade scartate, e perché:
 *
 *  - **record temporaneo** (salvare una bozza per avere un id): un task che
 *    esiste a metà va poi escluso da elenchi, ricerche, contatori, calendari e
 *    notifiche — cioè da ogni query dell'applicazione. Basta dimenticarne una e
 *    la bozza di qualcuno compare nella bacheca di un altro. Non vale il prezzo;
 *  - **base64 dentro il testo**: la descrizione viaggerebbe con dentro i
 *    megabyte dell'immagine. Le descrizioni hanno un limite di 20.000 caratteri
 *    (uno scatto di schermo ne fa qualche centinaio di migliaia), passano dalla
 *    ripulitura, finiscono nella ricerca, negli estratti e nelle email: un
 *    allegato travestito da testo che ingrassa ogni query.
 *
 * La strada presa è la terza: **si carica subito, si lega dopo**. La figura
 * viene messa in un'area di attesa (`<uploads>/_pending/`, di chi l'ha
 * incollata), l'editor la mostra dal suo indirizzo provvisorio; al salvataggio
 * il record esiste, la figura **trasloca** accanto ad esso e l'indirizzo dentro
 * l'HTML viene riscritto. Da quel momento non c'è differenza con una figura
 * incollata in un record già salvato: stesso posto, stessa regola di accesso —
 * chi vede il record vede le sue figure.
 *
 * Ciò che resta in attesa è una descrizione mai salvata (dialogo abbandonato):
 * lo spazza il cron notturno.
 */

/** Cosa si può incollare. Immagini e basta: il resto è un allegato. */
export const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/** Limite di buon senso per uno scatto di schermo (5 MB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Cartella delle figure accanto al record, e area di attesa. */
export const INLINE_DIR = "_inline";
const PENDING_DIR = "_pending";

/** Quanto resta in attesa una figura mai salvata. */
export const PENDING_TTL_HOURS = 48;

export function inlinePath(taskId: string, filename: string): string {
  return path.join(taskId, INLINE_DIR, sanitizeFilename(filename));
}

function pendingPath(filename: string): string {
  return path.join(PENDING_DIR, sanitizeFilename(filename));
}

/** Il tipo MIME di un'estensione (null se non è un'immagine ammessa). */
export function imageTypeOf(extension: string): string | null {
  return (
    Object.entries(IMAGE_TYPES).find(([, ext]) => ext === extension.toLowerCase())?.[0] ?? null
  );
}

/** Controllo comune ai due punti di caricamento: tipo e dimensione. */
export function assertPastableImage(mimetype: string, size: number): string {
  const extension = IMAGE_TYPES[mimetype];
  if (!extension) throw badRequest("Si possono incollare solo immagini (PNG, JPG, GIF, WEBP)");
  if (size > MAX_IMAGE_BYTES) throw badRequest("Immagine troppo grande: il limite è 5 MB");
  return extension;
}

/** Indirizzo provvisorio di una figura in attesa. */
export function pendingUrl(id: string, ext: string): string {
  return `/api/inline-images/pending/${id}${ext}`;
}

/** Indirizzo definitivo, accanto al record. */
export function inlineUrl(taskId: string, filename: string): string {
  return `/api/tasks/${taskId}/inline/${filename}`;
}

/** Mette una figura in attesa e ne restituisce l'indirizzo provvisorio. */
export async function storePendingImage(
  userId: string,
  buffer: Buffer,
  extension: string,
): Promise<string> {
  const id = randomUUID();
  await attachmentStore().write(pendingPath(`${id}${extension}`), buffer);
  await prisma.pendingInlineImage.create({ data: { id, ext: extension, uploadedById: userId } });
  return pendingUrl(id, extension);
}

/** La chiave della figura in attesa nel magazzino allegati. */
export function pendingKey(id: string, ext: string): string {
  return pendingPath(`${id}${ext}`);
}

/**
 * Gli identificativi delle figure in attesa citate in un HTML. Si cerca
 * l'indirizzo per intero (non il solo uuid) e si accettano solo le estensioni
 * ammesse: quel che non combacia non è roba nostra e resta dov'è.
 */
const PENDING_REF = /\/api\/inline-images\/pending\/([0-9a-f-]{36})(\.png|\.jpg|\.gif|\.webp)/gi;

export function pendingImageIds(html: string | null | undefined): string[] {
  if (!html) return [];
  return [...new Set([...html.matchAll(PENDING_REF)].map((match) => match[1]!.toLowerCase()))];
}

/**
 * Lega al task le figure in attesa citate nella descrizione: le sposta accanto
 * ad esso e riscrive gli indirizzi. Ritorna l'HTML aggiornato (uguale
 * all'originale se non c'era niente da legare, così il chiamante può decidere
 * di non riscrivere il record).
 *
 * Prende solo le figure **di chi sta salvando** e ancora in attesa: un
 * indirizzo copiato da un'altra parte non trascina file altrui. Quel che non si
 * riesce a spostare si lascia com'è — meglio una figura che non si vede di un
 * salvataggio che fallisce per un file.
 */
export async function claimInlineImages(
  userId: string,
  taskId: string,
  html: string | null | undefined,
): Promise<string | null | undefined> {
  const ids = pendingImageIds(html);
  if (ids.length === 0 || !html) return html;

  const pending = await prisma.pendingInlineImage.findMany({
    where: { id: { in: ids }, uploadedById: userId },
  });
  if (pending.length === 0) return html;

  let updated = html;
  const moved: string[] = [];
  for (const image of pending) {
    const filename = `${image.id}${image.ext}`;
    try {
      // Copia-e-cancella invece di `rename`: tra due magazzini (o due dischi)
      // lo spostamento atomico non esiste, e la copia riuscita è la condizione
      // per cancellare l'originale.
      const store = attachmentStore();
      await store.write(
        inlinePath(taskId, filename),
        await store.read(pendingKey(image.id, image.ext)),
      );
      await store.remove(pendingKey(image.id, image.ext));
    } catch {
      // File sparito (o disco che dice di no): la riga in attesa se ne va lo
      // stesso al prossimo giro di pulizia, e l'indirizzo resta quello vecchio.
      continue;
    }
    moved.push(image.id);
    updated = updated.split(pendingUrl(image.id, image.ext)).join(inlineUrl(taskId, filename));
  }
  if (moved.length > 0) {
    await prisma.pendingInlineImage.deleteMany({ where: { id: { in: moved } } });
  }
  return updated;
}

/**
 * Spazza le figure rimaste in attesa oltre il tempo previsto: sono descrizioni
 * mai salvate. Ritorna quante ne ha tolte.
 */
export async function purgePendingInlineImages(now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - PENDING_TTL_HOURS * 60 * 60 * 1000);
  const stale = await prisma.pendingInlineImage.findMany({ where: { createdAt: { lt: limit } } });
  for (const image of stale) {
    await attachmentStore().remove(pendingKey(image.id, image.ext));
  }
  if (stale.length > 0) {
    await prisma.pendingInlineImage.deleteMany({ where: { id: { in: stale.map((i) => i.id) } } });
  }
  return stale.length;
}

/**
 * Il gesto completo, in una riga per chi crea un record: lega le figure in
 * attesa e, se qualcosa è cambiato, riscrive la descrizione.
 *
 * **Chi crea un record con una descrizione scritta a mano deve chiamarlo.**
 * Oggi sono due porte — il nuovo task (che copre anche i task di progetto) e la
 * nuova richiesta di supporto; ognuna ha il suo caso nei test. Chi ne aggiunge
 * una terza senza questa chiamata non rompe niente subito: le figure restano
 * visibili a chi le ha incollate e spariscono dopo due giorni, che è
 * esattamente il difetto che i test qui accanto descrivono.
 */
export async function bindPendingImages(
  userId: string,
  taskId: string,
  description: string | null,
): Promise<void> {
  const updated = await claimInlineImages(userId, taskId, description);
  if (updated === description) return;
  await prisma.task.update({ where: { id: taskId }, data: { description: updated ?? null } });
}

/**
 * Toglie dal magazzino le figure incollate in un task, quando il task viene
 * eliminato **per davvero**.
 *
 * Sono l'unico allegato senza un record: il loro riferimento è l'`<img src>`
 * dentro la descrizione, quindi non c'è nessuna cascata che le porti via. Vive
 * qui e non nel cestino perché la regola di dove stanno — `<taskId>/_inline/`
 * — è di questo modulo, e sapere quel percorso in due punti vuol dire
 * dimenticarne uno il giorno che cambia.
 */
export async function removeInlineImages(taskId: string): Promise<number> {
  const store = attachmentStore();
  const files = await store.list(path.join(taskId, INLINE_DIR)).catch(() => []);
  for (const file of files) {
    await store.remove(file.key).catch(() => undefined);
  }
  return files.length;
}

/**
 * **Una descrizione copiata da un altro record, senza le sue figure**
 * (06/10/2026): le immagini incollate stanno accanto al record d'origine
 * (`/api/tasks/<id>/inline/…`), e copiarne gli indirizzi farebbe mostrare al
 * record nuovo file di un altro — che si romperebbero se quello sparisse. Si
 * tolgono i tag `<img>` che puntano lì; il resto del testo resta com'è.
 */
export function withoutInlineImagesOf(
  html: string | null | undefined,
  taskId: string,
): string | null {
  if (!html) return html ?? null;
  const indirizzo = `/api/tasks/${taskId}/inline/`.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return html.replace(
    new RegExp(`<img\\b[^>]*\\ssrc=["'][^"']*${indirizzo}[^"']*["'][^>]*>`, "gi"),
    "",
  );
}
