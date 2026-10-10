// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import path from "node:path";
import { config } from "../../config";
import { prisma } from "../../db";
import { gcsStore, parseGcsUri } from "./gcs-store";
import { localStore, setAttachmentStore, withFallback, type FileStore } from "./store";

/**
 * Dove tenere gli allegati: **una parte si configura, una parte no**.
 *
 * - la **cartella** su disco si sceglie dall'applicazione (pagina Sistema) e
 *   vive in banca dati, come l'indirizzo pubblico della posta: si cambia con
 *   l'anteprima davanti, senza aprire un file sul server e riavviare;
 * - il **bucket** e il progetto Google stanno nel `.env` e non si toccano da
 *   pagina, come le credenziali SMTP: spostare il magazzino di tutti i
 *   documenti è un'operazione da sistemista, non un campo in un form. In
 *   pagina si legge dove sono i file, mai una credenziale.
 *
 * `UPLOADS_DIR` resta il valore di partenza per un'installazione nuova.
 */
const LOCAL_DIR_KEY = "attachments.localDir";

export interface AttachmentSettings {
  /** Cartella su disco in uso (assoluta). */
  localDir: string;
  /** Da dove arriva la cartella: dalla pagina o dal `.env`. */
  localDirSource: "configurazione" | "ambiente";
  backend: "LOCAL" | "GCP";
  /** Indirizzo del bucket, se configurato (`gs://…`). */
  uri: string;
  gcpProject: string;
  /** Dove stavano i file prima di un trasloco nel bucket: si cerca anche lì. Vuoto = nessuno. */
  previousUri: string;
}

export async function readAttachmentSettings(): Promise<AttachmentSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: LOCAL_DIR_KEY } });
  const chosen = row?.value?.trim();
  return {
    localDir: chosen && chosen.length > 0 ? chosen : config.uploadsDir,
    localDirSource: chosen && chosen.length > 0 ? "configurazione" : "ambiente",
    backend: config.attachments.backend,
    uri: config.attachments.uri,
    gcpProject: config.attachments.gcpProject,
    previousUri: config.attachments.previousUri,
  };
}

/**
 * Cambia la cartella degli allegati. **Non sposta i file**: spostare è
 * un'azione a sé (`moveAttachments`), che si vede e si può leggere nel
 * resoconto — cambiare la cartella e trovarsi i documenti spariti sarebbe la
 * stessa cosa vista dall'utente, ma senza nessuno che l'ha deciso.
 */
export async function writeAttachmentLocalDir(dir: string): Promise<void> {
  const value = dir.trim();
  if (value && !path.isAbsolute(value)) {
    throw new Error("La cartella degli allegati dev'essere un percorso assoluto");
  }
  await prisma.appSetting.upsert({
    where: { key: LOCAL_DIR_KEY },
    update: { value },
    create: { key: LOCAL_DIR_KEY, value },
  });
}

/**
 * Il magazzino che corrisponde alle impostazioni correnti.
 *
 * `transitionFallback` (acceso di default) aggiunge la rete di sicurezza sul
 * bucket: si scrive lì, ma un file non ancora spostato si legge ancora dalla
 * cartella. Va **spento quando il magazzino è la destinazione di uno
 * spostamento**: con la rete accesa, `exists()` risponde di sì anche per i file
 * che stanno solo nell'origine, e la copia si salta da sola credendo di aver
 * già fatto — un "26 già presenti, 0 da spostare" con il bucket vuoto
 * (18/08/2026, difetto trovato alla prima prova sul serio).
 */
export function storeFor(
  settings: AttachmentSettings,
  { transitionFallback = true }: { transitionFallback?: boolean } = {},
): FileStore {
  if (settings.backend === "GCP") {
    const target = parseGcsUri(settings.uri);
    if (!target) {
      throw new Error(
        `ATTACHMENT=GCP ma ATTACHMENT_URI non è un indirizzo di bucket: "${settings.uri}" ` +
          '(atteso "gs://nome-bucket" o "gs://nome-bucket/sottocartella")',
      );
    }
    const bucket = gcsStore({ ...target, projectId: settings.gcpProject || null });
    if (!transitionFallback) return bucket;
    // Durante un trasloco nel bucket: prima il posto nuovo, poi quello vecchio,
    // poi il disco del passaggio originale (vedi ATTACHMENT_URI_PRECEDENTE).
    const precedente = settings.previousUri ? parseGcsUri(settings.previousUri) : null;
    if (settings.previousUri && !precedente) {
      throw new Error(
        `ATTACHMENT_URI_PRECEDENTE non è un indirizzo di bucket: "${settings.previousUri}"`,
      );
    }
    const disco = localStore(settings.localDir);
    return precedente
      ? withFallback(
          bucket,
          withFallback(gcsStore({ ...precedente, projectId: settings.gcpProject || null }), disco),
        )
      : withFallback(bucket, disco);
  }
  return localStore(settings.localDir);
}

/**
 * Monta il magazzino all'avvio. Un errore di configurazione **ferma il boot**:
 * partire con `ATTACHMENT=GCP` e un indirizzo storto vorrebbe dire scrivere i
 * documenti sul disco locale credendo di metterli nel bucket, e accorgersene
 * il giorno in cui si cerca un file.
 */
export async function initAttachmentStore(): Promise<AttachmentSettings> {
  const settings = await readAttachmentSettings();
  setAttachmentStore(storeFor(settings));
  return settings;
}
