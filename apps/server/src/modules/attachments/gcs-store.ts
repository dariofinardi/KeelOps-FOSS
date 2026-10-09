import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Contatore } from "./store";
import { safeKey, type FileStore } from "./store";

/**
 * **Il file non c'è, oppure non ho potuto chiedere.** Google risponde 404 solo
 * per il primo caso: tutto il resto — credenziali, rete, un 503 del servizio —
 * è un'altra storia, e confonderle vuol dire dichiarare perduto un contratto
 * che sta al suo posto (04/09/2026).
 */
export function fileNonTrovato(errore: unknown): boolean {
  return (errore as { code?: number } | null)?.code === 404;
}

/**
 * Gli allegati su un **bucket Google Cloud Storage**.
 *
 * Si accende dalla configurazione (`ATTACHMENT=GCP`, `ATTACHMENT_URI=gs://…`,
 * `ATTACHMENT_GCP_PROJECT`), come il mailer: configurato = acceso. Le
 * **credenziali non stanno nel `.env`** e non passano da qui — si usano le
 * *Application Default Credentials* di Google, cioè il service account della
 * macchina (o `GOOGLE_APPLICATION_CREDENTIALS`). Una chiave privata dentro il
 * file di configurazione dell'applicazione è una chiave che prima o poi finisce
 * in un backup, in un log o in una copia del `.env`.
 *
 * L'SDK si carica con **import dinamico**, come `nodemailer`: chi tiene i file
 * su disco non paga cinque megabyte di dipendenza a ogni avvio.
 *
 * Il `prefix` viene dall'URI (`gs://bucket/sottocartella`) e permette di tenere
 * più installazioni nello stesso bucket senza che si calpestino.
 */
export interface GcsTarget {
  bucket: string;
  /** Sottocartella dentro il bucket, senza barre ai lati. Vuota = radice. */
  prefix: string;
  projectId: string | null;
}

/**
 * Legge `gs://bucket/prefisso` — la forma in cui un indirizzo di bucket si
 * scrive ovunque (console, `gcloud`, documentazione), quindi quella che uno
 * copia e incolla. Null se non è un indirizzo `gs://` con un bucket dentro.
 */
export function parseGcsUri(uri: string): { bucket: string; prefix: string } | null {
  const match = /^gs:\/\/([^/]+)\/?(.*)$/.exec(uri.trim());
  if (!match) return null;
  const bucket = match[1]!;
  const prefix = (match[2] ?? "").replace(/^\/+|\/+$/g, "");
  return bucket ? { bucket, prefix } : null;
}

/**
 * **Le cartelle delle altre istanze** (02/10/2026). Più istanze di produzione
 * condividono il bucket, ognuna nella sua sottocartella `istanze/<nome>`. Quella
 * di Jugaad però è nata alla **radice**, e alla radice un elenco vede tutto: la
 * pulizia degli orfani avrebbe trovato i file dello studio vicino (nessun record
 * suo li nomina) e li avrebbe cancellati, e lo zip di backup se li sarebbe
 * portati via. Perciò chi sta alla radice non vede, non scrive e non cancella
 * niente sotto `istanze/`: è terreno degli altri.
 */
export const PREFISSO_ISTANZE = "istanze";

/** Un oggetto del bucket appartiene all'istanza con questo prefisso? */
export function dellIstanza(nomeOggetto: string, prefix: string): boolean {
  if (prefix) return nomeOggetto.startsWith(`${prefix}/`);
  return !nomeOggetto.startsWith(`${PREFISSO_ISTANZE}/`);
}

export function gcsStore(target: GcsTarget): FileStore {
  const objectName = (key: string) => {
    const nome = target.prefix ? `${target.prefix}/${safeKey(key)}` : safeKey(key);
    if (!dellIstanza(nome, target.prefix)) {
      throw new Error(`"${key}" sta nella cartella di un'altra istanza: non la tocco`);
    }
    return nome;
  };

  // Un solo client per processo, creato alla prima chiamata vera: importare
  // l'SDK all'avvio costerebbe anche a chi non lo usa.
  let bucketPromise: Promise<import("@google-cloud/storage").Bucket> | null = null;
  const bucket = async () => {
    if (!bucketPromise) {
      bucketPromise = import("@google-cloud/storage").then(({ Storage }) => {
        const storage = new Storage(target.projectId ? { projectId: target.projectId } : {});
        return storage.bucket(target.bucket);
      });
    }
    return bucketPromise;
  };

  return {
    kind: "gcs",
    describe: () => `gs://${target.bucket}${target.prefix ? `/${target.prefix}` : ""}`,
    async write(key, data) {
      const file = (await bucket()).file(objectName(key));
      // `resumable: false` per file piccoli: la sessione ripartibile costa due
      // viaggi in più e qui gli allegati sono documenti, non filmati.
      await file.save(data, { resumable: false });
    },
    async writeStream(key, source) {
      const file = (await bucket()).file(objectName(key));
      const contatore = new Contatore();
      await pipeline(source, contatore, file.createWriteStream({ resumable: false }));
      return contatore.bytes;
    },
    async read(key) {
      const [contents] = await (await bucket()).file(objectName(key)).download();
      return contents;
    },
    async stream(key, range): Promise<Readable> {
      const file = (await bucket()).file(objectName(key));
      // Come sul disco: l'assenza si scopre PRIMA di iniziare a rispondere,
      // altrimenti il browser riceve un download troncato invece di un 404.
      const [exists] = await file.exists();
      if (!exists) throw new Error(`Allegato non trovato: ${key}`);
      return file.createReadStream(range ? { start: range.start, end: range.end } : undefined);
    },
    async exists(key) {
      const [exists] = await (await bucket()).file(objectName(key)).exists();
      return exists;
    },
    /**
     * **«Non c'è» e «non ho potuto chiedere» non sono la stessa cosa.**
     *
     * Qualunque errore diventava `null`, e chi legge si sentiva rispondere «File
     * non presente nel magazzino allegati»: un contratto perfettamente al suo
     * posto dichiarato perduto perché il bucket non aveva risposto — e senza una
     * riga nei log per capirlo (04/09/2026). Ora il 404 resta `null`, tutto il
     * resto risale come errore e si vede.
     */
    async size(key) {
      try {
        const [metadata] = await (await bucket()).file(objectName(key)).getMetadata();
        return Number(metadata.size ?? 0);
      } catch (errore) {
        if (fileNonTrovato(errore)) return null;
        throw errore;
      }
    },
    async remove(key) {
      await (
        await bucket()
      )
        .file(objectName(key))
        .delete({ ignoreNotFound: true })
        .catch(() => undefined);
    },
    async list(prefix) {
      const full = prefix ? objectName(prefix) : target.prefix;
      const [files] = await (await bucket()).getFiles(full ? { prefix: full } : {});
      const cut = target.prefix ? target.prefix.length + 1 : 0;
      return files
        .filter((file) => dellIstanza(file.name, target.prefix))
        .map((file) => ({
          key: file.name.slice(cut),
          size: Number(file.metadata.size ?? 0),
          // `timeCreated` e non `updated`: una ricopiatura o un cambio di classe
          // di archiviazione muovono la seconda senza che il file sia cambiato,
          // e la pulizia ne ricaverebbe un'età sbagliata.
          writtenAt: new Date(file.metadata.timeCreated ?? file.metadata.updated ?? Date.now()),
        }));
    },
  };
}
