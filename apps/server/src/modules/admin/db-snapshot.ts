import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, readFile as read } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { APP_VERSION } from "@kancrm/shared";
import { config } from "../../config";
import { attachmentStore } from "../attachments/store";
import { databasePath } from "../../db";
import { dumpDatabase, estensioneDump } from "./dump-db";

/**
 * **Copia notturna del solo database, nel magazzino degli allegati.**
 *
 * Complementare allo zip di `backup.ts`, non sostitutiva, e la differenza è il
 * punto:
 *
 *  - lo **zip** (02:30, `data/backups`) contiene database *e* allegati, e vive
 *    sul disco della macchina. È il ripristino completo — se c'è ancora la
 *    macchina;
 *  - questa **istantanea** (mezzanotte, `backup/` dentro il magazzino) contiene
 *    solo il database e vive **dove vivono gli allegati**: in produzione il
 *    bucket. È la copia che sopravvive alla macchina, ed è piccola perché gli
 *    allegati stanno già lì accanto — rimetterli nello zip ogni notte
 *    significherebbe duplicare nel bucket, ogni notte, tutto ciò che il bucket
 *    contiene già.
 *
 * Il nome porta **quando** e **cosa girava**: `keelops-20260819-0000-0.9.162-66a2c9d.db.gz`.
 * Al momento del ripristino la domanda è sempre la stessa — "questo file con
 * quale codice ci va?" — e uno schema di migrazioni non è reversibile: un
 * database di ieri sotto il codice di domani è un servizio che non parte, o
 * peggio parte e sbaglia.
 *
 * **La copia è consistente**: `better-sqlite3` usa l'API di backup di SQLite,
 * sicura in WAL mode. Copiare il file con `cp` mentre il servizio scrive
 * produce un archivio che sembra sano e si apre corrotto — e lo si scopre il
 * giorno peggiore.
 *
 * **Contiene tutto**, impronte delle password comprese: chi legge il bucket
 * legge il database. Il "pepe" delle password vive però in un file **fuori**
 * dal database (`PASSWORD_PEPPER_FILE`), quindi una copia da sola non basta a
 * provare le password — che è esattamente perché sta fuori.
 */

const execFileAsync = promisify(execFile);

/**
 * La cartella dentro il magazzino. Non si configura: è una convenzione, e
 * cercarla altrove costa tempo il giorno del ripristino. **Senza barra
 * finale**: `safeKey` rifiuta i segmenti vuoti, quindi `"backup/"` passato a
 * `list()` esplode invece di elencare.
 */
export const SNAPSHOT_PREFIX = "backup";

/**
 * Cosa gira in produzione. Il deploy lascia `DEPLOYED_COMMIT` accanto
 * all'applicazione (hash, versione, data): è la verità, perché la copia in
 * esecuzione non ha un `.git` da interrogare. In sviluppo si ripiega su git, e
 * se non c'è nemmeno quello resta la versione — che è già metà della risposta.
 */
export async function deployedRevision(): Promise<{ version: string; commit: string | null }> {
  const version = APP_VERSION;

  const marker = config.deployedCommitFile;
  if (marker) {
    const text = await read(marker, "utf8").catch(() => null);
    const hash = text?.trim().split(/\s+/)[0];
    if (hash && /^[0-9a-f]{7,40}$/i.test(hash)) return { version, commit: hash.slice(0, 7) };
  }

  const fromGit = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: path.dirname(databasePath),
  }).catch(() => null);
  const commit = fromGit?.stdout.trim();
  return { version, commit: commit && /^[0-9a-f]{7,40}$/i.test(commit) ? commit : null };
}

/**
 * Il nome del file. Puro e collaudato perché è **l'unica cosa che si legge** in
 * un elenco di cento istantanee: l'ordine alfabetico dev'essere l'ordine
 * cronologico, quindi la data va davanti e in forma compatta.
 */
export function snapshotName(
  now: Date,
  version: string,
  commit: string | null,
  /** L'estensione dice cosa c'è dentro: una copia SQLite o un dump SQL. */
  estensione: "db" | "sql" = estensioneDump(),
): string {
  const iso = now.toISOString();
  const day = iso.slice(0, 10).replaceAll("-", "");
  const time = iso.slice(11, 16).replace(":", "");
  return `keelops-${day}-${time}-${version}${commit ? `-${commit}` : ""}.${estensione}.gz`;
}

/** La data di un'istantanea dal suo nome, per la retention. `null` se non è uno dei nostri. */
export function snapshotDate(name: string): Date | null {
  const match = /^keelops-(\d{8})-(\d{4})-/.exec(name);
  if (!match) return null;
  const [, day, time] = match;
  const iso = `${day!.slice(0, 4)}-${day!.slice(4, 6)}-${day!.slice(6, 8)}T${time!.slice(0, 2)}:${time!.slice(2, 4)}:00.000Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Scrive l'istantanea e applica la retention (`BACKUP_RETENTION_DAYS`, la
 * stessa dello zip: una politica sola, non due da tenere allineate).
 * Restituisce la chiave scritta.
 */
export async function runDatabaseSnapshot(now = new Date()): Promise<string> {
  const { version, commit } = await deployedRevision();
  const key = `${SNAPSHOT_PREFIX}/${snapshotName(now, version, commit)}`;

  // Copia consistente su file temporaneo, poi in memoria per comprimerla: il
  // database è dell'ordine delle decine di MB e comprime moltissimo, quindi
  // tenerlo in RAM un istante costa meno che gestire uno stream a due strati.
  const tempDir = await mkdtemp(path.join(tmpdir(), "keelops-snapshot-"));
  // Il come lo sa `dump-db`: qui interessa solo avere un file da comprimere.
  const { file: tempFile } = await dumpDatabase(tempDir);

  const store = attachmentStore();
  try {
    await store.write(key, gzipSync(await readFile(tempFile)));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  await pruneSnapshots(now);
  return key;
}

/**
 * Via le istantanee più vecchie della retention. La data si legge **dal nome**
 * e non dai metadati del file: sul bucket la data di modifica di un oggetto può
 * cambiare per motivi che non c'entrano col suo contenuto (una ricopiatura, un
 * cambio di classe di archiviazione), e cancellare per quella vorrebbe dire
 * cancellare per una ragione che non conosciamo.
 */
export async function pruneSnapshots(now = new Date()): Promise<number> {
  const store = attachmentStore();
  const cutoff = now.getTime() - config.backupRetentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const file of await store.list(SNAPSHOT_PREFIX)) {
    const date = snapshotDate(path.basename(file.key));
    if (date && date.getTime() < cutoff) {
      await store.remove(file.key);
      removed += 1;
    }
  }
  return removed;
}
