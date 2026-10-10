// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { prisma } from "../../db";
import { config } from "../../config";
import { attachmentStore } from "../attachments/store";
import { SNAPSHOT_PREFIX, snapshotDate } from "./db-snapshot";

/**
 * **Quanto spazio occupano i file, e quando lo si è misurato.**
 *
 * Il conto si fa elencando il magazzino, e su un bucket elencare non è gratis:
 * è una chiamata di rete per pagina di risultati, pagata ogni volta. Finora la
 * pagina Sistema la faceva **a ogni apertura**, il che va bene con seimila file
 * e smette di andare bene molto prima di quanto si creda.
 *
 * Quindi: si conta **una volta al giorno**, il risultato si tiene, e la pagina
 * mostra il numero **con la data in cui è stato preso**. Un numero senza la sua
 * data non si sa se valga ancora; con la data, chi guarda decide da sé — e se
 * non gli basta c'è il pulsante per rifare il conto adesso.
 *
 * La cache sta in `AppSetting` e non in memoria: un riavvio non deve far
 * ripartire da "non lo so", e il conteggio di ieri resta valido stanotte.
 *
 * **Le istantanee del database si contano a parte.** Vivono nello stesso
 * magazzino degli allegati (`backup/`), ma sono un'altra cosa: se il bucket
 * cresce, la prima domanda è se a crescere sono i documenti degli utenti o le
 * copie notturne, e un totale unico non risponde.
 */

const CACHE_KEY = "storage.usage";

/** Ogni quanto si riconta da solo. Oltre, il valore si mostra come vecchio. */
export const RECOUNT_AFTER_HOURS = 24;

export interface StorageUsage {
  /** Gli allegati: tutto il magazzino tranne le istantanee. */
  files: number;
  bytes: number;
  /** Le istantanee del database che stanno nello stesso magazzino. */
  backupFiles: number;
  backupBytes: number;
  /** Quando è stato preso questo conteggio (ISO). */
  countedAt: string;
  /** Quanto è durato. Se un giorno diventa lento, si vede prima di subirlo. */
  tookMs: number;
  /** Il magazzino non risponde: si dice, invece di mostrare uno zero. */
  error: string | null;
}

/** Elenca il magazzino e somma. È la parte cara: la chiama solo chi conta. */
export async function computeStorageUsage(now = new Date()): Promise<StorageUsage> {
  const iniziato = Date.now();
  const vuoto = {
    files: 0,
    bytes: 0,
    backupFiles: 0,
    backupBytes: 0,
    countedAt: now.toISOString(),
  };
  try {
    const files = await attachmentStore().list();
    const prefisso = `${SNAPSHOT_PREFIX}/`;
    const usage = files.reduce(
      (acc, file) => {
        const backup = file.key.startsWith(prefisso);
        return {
          files: acc.files + (backup ? 0 : 1),
          bytes: acc.bytes + (backup ? 0 : file.size),
          backupFiles: acc.backupFiles + (backup ? 1 : 0),
          backupBytes: acc.backupBytes + (backup ? file.size : 0),
        };
      },
      { files: 0, bytes: 0, backupFiles: 0, backupBytes: 0 },
    );
    return { ...usage, countedAt: now.toISOString(), tookMs: Date.now() - iniziato, error: null };
  } catch (error) {
    // Bucket sbagliato, credenziali scadute: la pagina Sistema è esattamente
    // il posto dove uno viene a capire perché non funziona.
    return {
      ...vuoto,
      tookMs: Date.now() - iniziato,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Il conteggio tenuto da parte. `null` se non è mai stato fatto. */
export async function cachedStorageUsage(): Promise<StorageUsage | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: CACHE_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as StorageUsage;
  } catch {
    // Un valore illeggibile vale quanto un valore assente: si riconterà.
    return null;
  }
}

/** Conta e tiene il risultato. È quello che chiama sia il cron sia il pulsante. */
export async function refreshStorageUsage(now = new Date()): Promise<StorageUsage> {
  const usage = await computeStorageUsage(now);
  await prisma.appSetting.upsert({
    where: { key: CACHE_KEY },
    update: { value: JSON.stringify(usage) },
    create: { key: CACHE_KEY, value: JSON.stringify(usage) },
  });
  return usage;
}

/** Il conteggio è più vecchio del giro quotidiano? */
export function isStale(usage: StorageUsage | null, now = new Date()): boolean {
  if (!usage) return true;
  const at = new Date(usage.countedAt).getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > RECOUNT_AFTER_HOURS * 60 * 60 * 1000;
}

/* ── lo stato dei backup ─────────────────────────────────────────────────── */

export interface BackupFile {
  name: string;
  /** Quando è stato fatto (ISO). */
  at: string;
  bytes: number;
}

export interface BackupStatus {
  /** L'istantanea di mezzanotte, dove vivono gli allegati (in produzione il bucket). */
  snapshot: BackupFile | null;
  /** Quante ce ne sono, e quanto pesano in tutto. */
  snapshotCount: number;
  snapshotBytes: number;
  /** Lo zip delle 02:30 sul disco della macchina: database più allegati. */
  zip: BackupFile | null;
  zipCount: number;
  zipBytes: number;
  /** Dopo quanti giorni sia l'uno sia l'altro vengono eliminati. */
  retentionDays: number;
  /**
   * Lo zip contiene anche gli allegati? Solo quando vivono su questo disco:
   * con un bucket ci starebbe il solo database, e la pagina deve dirlo — un
   * archivio che si crede completo è peggio di uno dichiarato parziale.
   */
  zipConAllegati: boolean;
  error: string | null;
}

/**
 * Lo stato dei due backup, **letto al momento**: sono pochi file (la retention
 * li tiene tali) e su un bucket è una sola richiesta per prefisso, quindi qui
 * la cache costerebbe più di quanto risparmia. La data di un'istantanea si
 * legge **dal nome**, come nella retention: sul bucket la data di modifica di
 * un oggetto può cambiare per motivi che non riguardano il suo contenuto.
 */
export async function backupStatus(): Promise<BackupStatus> {
  const base: BackupStatus = {
    snapshot: null,
    snapshotCount: 0,
    snapshotBytes: 0,
    zip: null,
    zipCount: 0,
    zipBytes: 0,
    retentionDays: config.backupRetentionDays,
    zipConAllegati: attachmentStore().kind === "local",
    error: null,
  };

  let snapshot = base.snapshot;
  let snapshotCount = 0;
  let snapshotBytes = 0;
  let error: string | null = null;
  try {
    for (const file of await attachmentStore().list(SNAPSHOT_PREFIX)) {
      const name = path.basename(file.key);
      const date = snapshotDate(name);
      if (!date) continue;
      snapshotCount += 1;
      snapshotBytes += file.size;
      if (!snapshot || date.toISOString() > snapshot.at) {
        snapshot = { name, at: date.toISOString(), bytes: file.size };
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let zip = base.zip;
  let zipCount = 0;
  let zipBytes = 0;
  for (const name of await readdir(config.backupsDir).catch(() => [] as string[])) {
    if (!name.startsWith("kancrm-backup-") || !name.endsWith(".zip")) continue;
    const info = await stat(path.join(config.backupsDir, name)).catch(() => null);
    if (!info) continue;
    zipCount += 1;
    zipBytes += info.size;
    const at = new Date(info.mtimeMs).toISOString();
    if (!zip || at > zip.at) zip = { name, at, bytes: info.size };
  }

  return { ...base, snapshot, snapshotCount, snapshotBytes, zip, zipCount, zipBytes, error };
}
