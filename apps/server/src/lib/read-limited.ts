import type { Readable } from "node:stream";

/**
 * Legge un flusso in un Buffer, ma **si ferma al tetto**: oltre `max` byte
 * il flusso si scarta e si risponde con `troppoGrande`. Serve alle figure
 * incollate, che hanno un tetto di 5 MB ma passavano da `toBuffer()` con il
 * limite generale dei caricamenti (80 MB): un file da 79 MB finiva tutto in
 * memoria solo per sentirsi dire «troppo grande».
 */
export async function readUpTo(
  source: Readable,
  max: number,
): Promise<{ buffer: Buffer; troppoGrande: boolean }> {
  const parti: Buffer[] = [];
  let letti = 0;
  for await (const chunk of source) {
    const b = chunk as Buffer;
    letti += b.length;
    if (letti > max) {
      source.resume(); // svuota il resto senza tenerlo
      return { buffer: Buffer.alloc(0), troppoGrande: true };
    }
    parti.push(b);
  }
  return { buffer: Buffer.concat(parti), troppoGrande: false };
}
