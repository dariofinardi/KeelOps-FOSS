import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import archiver from "archiver";
import { config } from "../../config";
import { attachmentStore } from "../attachments/store";
import { dumpDatabase } from "./dump-db";

/**
 * **Gli allegati entrano nello zip solo se stanno su questo disco.**
 *
 * Lo zip esiste per portare via una macchina intera: database più i file, in
 * un archivio solo. Ha senso finché i file sono qui. Quando il magazzino è un
 * **bucket** i file stanno già fuori, con la loro durabilità, e metterli nello
 * zip vuol dire **scaricarli tutti ogni notte per riscriverli sul disco da cui
 * si voleva scappare**: il 20/08/2026, dopo l'import degli allegati ClickUp,
 * sarebbero stati 4,6 GB a notte — oltre cento con la retention di trenta
 * giorni, su un disco che ne ha centocinquanta liberi.
 *
 * Quindi: magazzino locale → database **e** allegati; magazzino su bucket →
 * il solo database, e lo zip **lo dichiara** in un file di testo dentro
 * l'archivio. Chi ripristina fra un anno non deve dedurre da un `uploads/`
 * assente se i file mancano o non c'erano mai.
 *
 * L'istantanea di mezzanotte (`db-snapshot.ts`) non cambia: quella il solo
 * database l'ha sempre contenuto, e vive nel bucket accanto agli allegati.
 */
/** Cosa c'è in questo archivio, e cosa no: si legge senza aprire il database. */
function spiegazione(conAllegati: boolean, dove: string, nomeDb: string): string {
  return conAllegati
    ? [
        "Backup KeelOps",
        "",
        `  ${nomeDb.padEnd(10)} il database (${nomeDb.endsWith(".sql") ? "dump SQL di MariaDB" : "copia consistente, API di backup di SQLite"})`,
        "  uploads/   gli allegati, come stanno nel magazzino",
        "  assenze-*  la memoria del modello delle assenze e il registro del",
        "             calendario (se esistono): si rifanno da soli, ma rifarli",
        "             costa una notte di modello e una storia che si perde",
        "",
        `Magazzino al momento del backup: ${dove}`,
        "",
      ].join("\n")
    : [
        "Backup KeelOps — SOLO DATABASE",
        "",
        `  ${nomeDb.padEnd(10)} il database (${nomeDb.endsWith(".sql") ? "dump SQL di MariaDB" : "copia consistente, API di backup di SQLite"})`,
        "",
        "Gli allegati NON sono in questo archivio: vivono su un magazzino remoto,",
        `che al momento del backup era ${dove}.`,
        "Stanno già fuori da questa macchina e hanno la propria durabilità;",
        "rimetterli qui ogni notte vorrebbe dire copiarli sul disco da cui il",
        "backup serve a scappare.",
        "",
        "Per ripristinare servono due cose: questo app.db e l'accesso a quel",
        "magazzino. I percorsi dei file non cambiano (Attachment.path).",
        "",
      ].join("\n");
}

export async function writeBackupZip(targetPath: string): Promise<void> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "kancrm-backup-"));
  const store = attachmentStore();
  const conAllegati = store.kind === "local";
  // Elencare prima di aprire l'archivio: se il magazzino non risponde, il
  // backup fallisce subito invece di produrre uno zip a metà. Con il bucket
  // non si elenca affatto: non serve, ed è una chiamata di rete per pagina.
  const allegati = conAllegati ? await store.list() : [];
  // Come si porta via il database lo sa `dump-db`: la copia consistente del
  // file su SQLite, il dump SQL su MariaDB. Il nome dentro lo zip segue il
  // formato, o un `.db` che contiene SQL renderebbe l'archivio inservibile.
  const { file: backupDbPath, formato } = await dumpDatabase(tempDir);
  const nomeNelloZip = `app.${formato}`;

  try {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(targetPath);
      const archive = archiver("zip", { zlib: { level: 6 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.file(backupDbPath, { name: nomeNelloZip });
      archive.append(spiegazione(conAllegati, store.describe(), nomeNelloZip), {
        name: "LEGGIMI.txt",
      });
      // La memoria del modello delle assenze e il registro delle impronte del
      // calendario: file piccoli che si rifanno da soli, ma rifarli costa una
      // notte di modello — e il registro È la storia di cosa è cambiato.
      for (const extra of [config.absenceMemoryFile, config.absenceRegistryFile]) {
        if (existsSync(extra)) archive.file(extra, { name: path.basename(extra) });
      }
      // Gli allegati arrivano dal **magazzino**, non dalla cartella: da quando
      // possono vivere su un bucket (18/08/2026) `archive.directory` avrebbe
      // messo nel backup una cartella vuota, e nessuno se ne sarebbe accorto
      // fino al giorno del ripristino.
      void (async () => {
        try {
          for (const file of allegati) {
            archive.append(await store.read(file.key), { name: `uploads/${file.key}` });
          }
        } finally {
          void archive.finalize();
        }
      })();
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Backup automatico giornaliero in data/backups (uno per giorno, idempotente)
 * con retention: elimina i backup più vecchi di `backupRetentionDays`.
 * Ritorna il path del file creato, o null se il backup di oggi esiste già.
 */
export async function runScheduledBackup(now = new Date()): Promise<string | null> {
  await mkdir(config.backupsDir, { recursive: true });
  const stamp = now.toISOString().slice(0, 10);
  const targetPath = path.join(config.backupsDir, `kancrm-backup-${stamp}.zip`);

  let created: string | null = null;
  if (!existsSync(targetPath)) {
    await writeBackupZip(targetPath);
    created = targetPath;
  }

  // Retention: via i file più vecchi di N giorni.
  const cutoff = now.getTime() - config.backupRetentionDays * 24 * 60 * 60 * 1000;
  for (const name of await readdir(config.backupsDir)) {
    if (!name.startsWith("kancrm-backup-") || !name.endsWith(".zip")) continue;
    const filePath = path.join(config.backupsDir, name);
    const info = await stat(filePath).catch(() => null);
    if (info && info.mtimeMs < cutoff) {
      await rm(filePath, { force: true });
    }
  }
  return created;
}
