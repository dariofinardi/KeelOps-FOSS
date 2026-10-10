// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { dellIstanza, PREFISSO_ISTANZE } from "./gcs-store";

/**
 * **Il trasloco di un'istanza dentro il bucket** (02/10/2026): da una cartella a
 * un'altra, per esempio da `gs://keelops` (la radice, dove è nata l'istanza di
 * Jugaad) a `gs://keelops/istanze/jugaad`.
 *
 * Diverso da `move.ts`, che sposta fra magazzini qualunque passando i byte dal
 * processo: qui sorgente e destinazione sono nello stesso servizio, e la copia
 * la fa **Google, dentro il bucket** — un file da mezzo gigabyte non attraversa
 * la rete né la memoria. Le regole:
 *
 *  - **prima si copia, poi si verifica, poi si cancella**: dimensione e CRC32C
 *    della copia devono essere quelli dell'originale, altrimenti l'originale resta;
 *  - **ciò che è già arrivato identico** non si ricopia, se ne toglie solo
 *    l'originale: così il trasloco si rilancia dopo un'interruzione;
 *  - **un file diverso già presente a destinazione** non si tocca né di qua né
 *    di là: si racconta, e decide una persona;
 *  - **mai fuori dalla propria cartella**: dalla radice non si prende niente
 *    sotto `istanze/` (sono le altre istanze, e lì c'è anche la destinazione).
 *
 * Il database non cambia: la chiave di un file è la stessa nei due posti.
 */

export interface OggettoBucket {
  name: string;
  size: number;
  /** Checksum che Google calcola per ogni oggetto (base64). */
  crc32c: string;
}

/** Il poco che serve del bucket: lo script lo collega a Google, i test a un finto. */
export interface BucketPerTrasloco {
  list(prefix: string): Promise<OggettoBucket[]>;
  meta(name: string): Promise<OggettoBucket | null>;
  copy(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface EsitoTrasloco {
  totali: number;
  copiati: number;
  /** Già a destinazione identici: tolto solo l'originale. */
  giaArrivati: number;
  byte: number;
  /** Presenti nei due posti ma diversi: non toccati. */
  conflitti: string[];
  errori: Array<{ key: string; motivo: string }>;
}

/** Perché un trasloco non si può fare, o null se si può. */
export function traslocoImpossibile(da: string, a: string): string | null {
  if (da === a) return "origine e destinazione sono la stessa cartella";
  if (!a) return "la destinazione non può essere la radice del bucket";
  if (!da && !a.startsWith(`${PREFISSO_ISTANZE}/`)) {
    // Dalla radice si prende tutto tranne istanze/: una destinazione fuori da
    // lì finirebbe dentro l'origine, e si sposterebbe dentro sé stessa.
    return `dalla radice si trasloca solo sotto ${PREFISSO_ISTANZE}/<nome>`;
  }
  if (da && a.startsWith(`${da}/`)) return "la destinazione sta dentro l'origine";
  return null;
}

export async function traslocaCartella(
  bucket: BucketPerTrasloco,
  da: string,
  a: string,
  opzioni: { esegui: boolean; avanzamento?: (fatti: number, totali: number) => void },
): Promise<EsitoTrasloco> {
  const motivo = traslocoImpossibile(da, a);
  if (motivo) throw new Error(motivo);
  const esito: EsitoTrasloco = {
    totali: 0,
    copiati: 0,
    giaArrivati: 0,
    byte: 0,
    conflitti: [],
    errori: [],
  };
  const taglio = da ? da.length + 1 : 0;
  const oggetti = (await bucket.list(da)).filter((o) => dellIstanza(o.name, da));
  esito.totali = oggetti.length;
  let fatti = 0;
  for (const origine of oggetti) {
    const key = origine.name.slice(taglio);
    const nomeDestinazione = `${a}/${key}`;
    try {
      const presente = await bucket.meta(nomeDestinazione);
      const uguale = (o: OggettoBucket | null) =>
        o !== null && o.size === origine.size && o.crc32c === origine.crc32c;
      if (presente && uguale(presente)) {
        if (opzioni.esegui) await bucket.remove(origine.name);
        esito.giaArrivati += 1;
      } else if (presente) {
        esito.conflitti.push(key);
      } else {
        if (opzioni.esegui) {
          await bucket.copy(origine.name, nomeDestinazione);
          const copia = await bucket.meta(nomeDestinazione);
          if (!uguale(copia))
            throw new Error("la copia non corrisponde all'originale: originale lasciato");
          await bucket.remove(origine.name);
        }
        esito.copiati += 1;
        esito.byte += origine.size;
      }
    } catch (errore) {
      esito.errori.push({
        key,
        motivo: errore instanceof Error ? errore.message : String(errore),
      });
    }
    fatti += 1;
    opzioni.avanzamento?.(fatti, oggetti.length);
  }
  return esito;
}
