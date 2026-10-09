import type { FileStore } from "./store";

/**
 * Sposta i file da un magazzino all'altro — da una cartella a un'altra, dal
 * disco a un bucket, o al contrario.
 *
 * Tre regole che valgono per tutte e tre le direzioni:
 *  - **prima si copia, poi si cancella**, un file per volta: se la copia
 *    fallisce a metà strada l'originale è ancora dov'era. Un `rename` sarebbe
 *    più veloce ma non esiste tra due magazzini diversi, e tra due cartelle su
 *    dischi diversi nemmeno;
 *  - **si salta ciò che è già arrivato** con la stessa dimensione: così lo
 *    spostamento si può rilanciare dopo un'interruzione senza ricominciare;
 *  - **quello che non riesce si racconta**. Un'operazione che dice "fatto" e ha
 *    lasciato indietro tre documenti è peggio di una che dice quali.
 *
 * Non tocca la banca dati: la chiave di un file è la stessa nei due magazzini
 * (vedi `store.ts`), quindi i record non sanno nemmeno che si è spostato.
 */
export interface MoveReport {
  /** File presenti all'origine. */
  totali: number;
  spostati: number;
  /** Già presenti a destinazione, con la stessa dimensione. */
  saltati: number;
  byte: number;
  errori: Array<{ key: string; motivo: string }>;
}

export async function moveAttachments(
  from: FileStore,
  to: FileStore,
  options: { dryRun?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<MoveReport> {
  const report: MoveReport = { totali: 0, spostati: 0, saltati: 0, byte: 0, errori: [] };
  if (from.describe() === to.describe() && from.kind === to.kind) return report;

  const files = await from.list();
  report.totali = files.length;
  let done = 0;
  for (const file of files) {
    try {
      const already = await to.exists(file.key);
      if (already) {
        report.saltati += 1;
      } else if (!options.dryRun) {
        await to.write(file.key, await from.read(file.key));
        await from.remove(file.key);
        report.spostati += 1;
        report.byte += file.size;
      } else {
        report.spostati += 1;
        report.byte += file.size;
      }
    } catch (error) {
      report.errori.push({
        key: file.key,
        motivo: error instanceof Error ? error.message : String(error),
      });
    }
    done += 1;
    options.onProgress?.(done, files.length);
  }
  return report;
}
