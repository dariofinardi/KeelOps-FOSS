// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform, type TransformCallback } from "node:stream";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { config } from "../../config";

/**
 * **Dove vivono i file**, dietro una porta sola.
 *
 * Fino al 18/08/2026 ogni modulo che salvava un allegato faceva `writeFile` su
 * un percorso calcolato a mano: otto punti diversi, e la domanda "e se i file
 * non stessero più su questo disco?" non aveva una risposta che non fosse
 * "cambiali tutti e otto". Qui c'è l'interfaccia, e i moduli non sanno più se
 * dietro c'è una cartella o un bucket.
 *
 * La **chiave** è quella che era il percorso relativo, e resta identica in
 * banca dati (`Attachment.path`): `<taskId>/<file>`, `_inline/<taskId>/<file>`,
 * `_avatars/<file>`, `_branding/<file>`, `_pending/<file>`. Nessuna migrazione
 * di dati per cambiare magazzino — si spostano i file, i record restano.
 *
 * Volutamente **a buffer e non a stream** per scrittura e lettura: gli allegati
 * qui sono documenti e schermate (in produzione 5,9 MB in tutto), e un'API a
 * stream su due implementazioni costa complessità che nessuno sta pagando. Lo
 * stream esiste solo dove serviva già, cioè servire un file al browser.
 */
export interface FileStore {
  readonly kind: "local" | "gcs";
  /** Dove sono i file, in una riga: si legge nella pagina Sistema. */
  describe(): string;
  write(key: string, data: Buffer): Promise<void>;
  /**
   * Scrive un flusso senza tenerlo in memoria e torna i byte scritti: è la
   * strada dei caricamenti, che prima passavano tutti da un Buffer (80 MB
   * per richiesta, senza tetto di concorrenza: O5 di PLAN_OPTIMIZE).
   */
  writeStream(key: string, source: Readable): Promise<number>;
  read(key: string): Promise<Buffer>;
  /**
   * Per servire il file al browser senza tenerlo tutto in memoria. Con
   * `range` restituisce solo quel tratto di byte: è ciò che chiede un lettore
   * video quando si trascina la barra, e senza il quale Safari si rifiuta
   * proprio di riprodurre.
   */
  stream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  /** Dimensione in byte, null se il file non c'è: serve al `Content-Length`. */
  size(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
  /**
   * Tutte le chiavi con dimensione e **data di scrittura**: conteggi,
   * migrazioni e pulizia degli orfani. La data serve a quest'ultima: un file
   * scritto un minuto fa può essere un caricamento ancora in volo, il cui
   * record nel database non è stato creato — cancellarlo è l'unico modo per
   * rompere qualcosa mentre si fa pulizia.
   */
  list(prefix?: string): Promise<Array<{ key: string; size: number; writtenAt: Date }>>;
}

/**
 * Normalizza e **verifica** una chiave.
 *
 * Vale per tutti i magazzini, non solo per il disco: su GCS un `..` non
 * risalirebbe niente, ma una chiave costruita con l'input di qualcuno è
 * comunque il posto sbagliato dove essere creativi. Le barre rovesciate di
 * Windows diventano barre normali, così la stessa chiave punta allo stesso
 * oggetto ovunque.
 */
export function safeKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (normalized === "" || parts.some((part) => part === "." || part === ".." || part === "")) {
    throw new Error("Percorso allegato non valido");
  }
  return parts.join("/");
}

/** Conta i byte che passano, senza toccarli. */
export class Contatore extends Transform {
  bytes = 0;
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.bytes += chunk.length;
    done(null, chunk);
  }
}

/** I file su disco: la cartella `UPLOADS_DIR` (o quella scelta in configurazione). */
export function localStore(root: string): FileStore {
  const absolute = (key: string) => path.resolve(root, safeKey(key));
  return {
    kind: "local",
    describe: () => root,
    async write(key, data) {
      const file = absolute(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    async writeStream(key, source) {
      const file = absolute(key);
      await mkdir(path.dirname(file), { recursive: true });
      const contatore = new Contatore();
      await pipeline(source, contatore, createWriteStream(file));
      return contatore.bytes;
    },
    read: (key) => readFile(absolute(key)),
    async stream(key, range) {
      // `createReadStream` non fallisce subito su un file assente: l'errore
      // arriverebbe a risposta già iniziata, e il browser vedrebbe un download
      // troncato invece di un 404.
      await stat(absolute(key));
      return createReadStream(absolute(key), range);
    },
    async exists(key) {
      return (await this.size(key)) !== null;
    },
    async size(key) {
      const info = await stat(absolute(key)).catch(() => null);
      return info ? info.size : null;
    },
    async remove(key) {
      await rm(absolute(key), { force: true }).catch(() => undefined);
    },
    async list(prefix) {
      const base = prefix ? path.resolve(root, safeKey(prefix)) : path.resolve(root);
      const out: Array<{ key: string; size: number; writtenAt: Date }> = [];
      const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else {
            const info = await stat(full).catch(() => null);
            if (info) {
              out.push({
                key: path.relative(root, full).split(path.sep).join("/"),
                size: info.size,
                writtenAt: info.mtime,
              });
            }
          }
        }
      };
      await walk(base);
      return out;
    },
  };
}

/**
 * Magazzino con una **rete di sicurezza in lettura**: scrive sempre nel primo,
 * ma se un file lì non c'è lo cerca nel secondo.
 *
 * Serve il giorno del passaggio al bucket. Accendere `ATTACHMENT=GCP` è
 * istantaneo, spostare i file no: senza questa rete, tra il riavvio e la fine
 * dello spostamento ogni allegato risponderebbe "non trovato" — e il giorno del
 * passaggio non è il giorno in cui si vuole spiegare a qualcuno che il suo
 * documento tornerà. Finito lo spostamento la rete non serve più e non fa
 * niente: nel magazzino vecchio non c'è rimasto niente da trovare.
 */
export function withFallback(primary: FileStore, fallback: FileStore): FileStore {
  const orFallback = async <T>(key: string, main: () => Promise<T>, spare: () => Promise<T>) => {
    if (await primary.exists(key)) return main();
    return (await fallback.exists(key)) ? spare() : main();
  };
  return {
    kind: primary.kind,
    describe: () => primary.describe(),
    write: (key, data) => primary.write(key, data),
    writeStream: (key, source) => primary.writeStream(key, source),
    read: (key) =>
      orFallback(
        key,
        () => primary.read(key),
        () => fallback.read(key),
      ),
    stream: (key, range) =>
      orFallback(
        key,
        () => primary.stream(key, range),
        () => fallback.stream(key, range),
      ),
    size: (key) =>
      orFallback(
        key,
        () => primary.size(key),
        () => fallback.size(key),
      ),
    exists: async (key) => (await primary.exists(key)) || fallback.exists(key),
    // Si cancella da tutti e due: un file "tolto" che riappare perché era
    // rimasto nella vecchia cartella è peggio di un file non cancellato.
    remove: async (key) => {
      await primary.remove(key);
      await fallback.remove(key);
    },
    // L'elenco è quello del magazzino vero: è ciò che si conta e si mostra.
    list: (prefix) => primary.list(prefix),
  };
}

/**
 * Il magazzino attivo, deciso dalla configurazione e costruito **una volta**.
 *
 * Stessa regola del mailer e di Ollama: **configurato = acceso**. Senza
 * `ATTACHMENT=GCP` si resta sul disco, che è il comportamento di sempre.
 */
let active: FileStore | null = null;

export function attachmentStore(): FileStore {
  if (!active) active = localStore(config.uploadsDir);
  return active;
}

/** Sostituisce il magazzino attivo: l'avvio (secondo configurazione) e i test. */
export function setAttachmentStore(store: FileStore | null): void {
  active = store;
}
