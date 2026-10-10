// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "../../db";
import { colonneTestualiSql, ident } from "../../lib/dialetto";
import { attachmentStore } from "./store";
import { SNAPSHOT_PREFIX } from "../admin/db-snapshot";

/**
 * **File orfani nel magazzino: quelli che non li reclama più nessuno.**
 *
 * Eliminare un task NON tocca i file — va nel cestino, e il file serve ancora
 * se lo si ripesca. E lo svuotamento definitivo del cestino i file li toglie
 * già, controllando la condivisione: `removeOrphanAttachmentFiles` salta un
 * allegato ancora legato a un altro task o a un modello di ricorrenza, che è
 * il caso del task da offerta vinta e, da ieri, del task duplicato.
 *
 * Resta però una via da cui nascono orfani veri: le **figure incollate dentro
 * le descrizioni**. Non hanno un record in tabella — il loro unico riferimento
 * è un `<img src>` dentro un testo — quindi quando il task viene eliminato per
 * davvero nessuno le porta via.
 *
 * Da qui questa pulizia notturna. E da qui le sue tre cautele, perché una
 * pulizia sbagliata cancella lavoro delle persone:
 *
 *  1. **I prefissi riservati non si toccano.** Le istantanee del database e
 *     l'area d'attesa delle figure hanno una loro scadenza; passare di qui
 *     vorrebbe dire applicargliene una seconda.
 *  2. **Il riferimento si cerca anche dentro i testi**, non solo nelle
 *     tabelle. Sul magazzino di produzione (20/08/2026) di 49 file 13 erano
 *     citati **solo** dentro una descrizione o in `avatarUrl`: una pulizia che
 *     avesse guardato la sola tabella `Attachment` avrebbe cancellato tredici
 *     immagini vive e la foto di un utente. La ricerca gira su TUTTE le
 *     colonne testuali del database, prese dallo schema al momento: così un
 *     campo di testo aggiunto domani è coperto senza che nessuno se ne ricordi.
 *  3. **I file recenti si lasciano stare.** Un caricamento in volo ha il file
 *     già scritto e il record ancora no: è la sola finestra in cui un orfano
 *     è in realtà un file appena nato.
 */

/** Sotto questa età un file non si considera orfano, qualunque cosa dica il database. */
export const GRACE_DAYS = 7;

/**
 * Quanti file al massimo si passano al setaccio dei testi in una notte. La
 * ricerca costa una query per colonna, e con un magazzino appena migrato i
 * candidati potrebbero essere migliaia. Quel che avanza si guarda la notte
 * dopo — e il numero finisce nel registro, perché una pulizia che tace su cio
 * che non ha esaminato si legge come "ho guardato tutto".
 */
export const MAX_CANDIDATI = 500;

/** Prefissi con una scadenza propria: non passano da questa pulizia. */
const RISERVATI = [`${SNAPSHOT_PREFIX}/`, "_pending/"];

export interface OrphanSweep {
  /** File esaminati nel magazzino. */
  esaminati: number;
  /** Saltati perché in un prefisso riservato. */
  riservati: number;
  /** Trovati referenziati: dalla tabella degli allegati o dentro un testo. */
  referenziati: number;
  /** Troppo recenti per poterli giudicare. */
  recenti: number;
  /** Rimasti fuori dal setaccio per il tetto: si riguardano la prossima volta. */
  rimandati: number;
  /** Le chiavi eliminate, e quanto spazio hanno liberato. */
  rimossi: string[];
  byte: number;
}

/**
 * Le colonne testuali del database, lette dallo schema.
 *
 * Un elenco scritto a mano invecchierebbe in silenzio: il giorno in cui
 * qualcuno aggiunge un campo descrittivo, i file citati lì dentro
 * diventerebbero cancellabili senza che nessuno colleghi le due cose.
 */
async function colonneTestuali(): Promise<Array<{ tabella: string; colonna: string }>> {
  // MySQL le tiene tutte in `information_schema` e risponde in una query sola.
  const inUnaSola = colonneTestualiSql();
  if (inUnaSola) {
    return prisma.$queryRawUnsafe<Array<{ tabella: string; colonna: string }>>(inUnaSola);
  }
  // SQLite: l'elenco delle tabelle, poi i PRAGMA di ognuna.
  const tabelle = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "select name from sqlite_master where type = 'table'",
  );
  const out: Array<{ tabella: string; colonna: string }> = [];
  for (const { name } of tabelle) {
    if (name.startsWith("_prisma") || name.startsWith("sqlite_")) continue;
    // I nomi vengono dallo schema, non da fuori: nessun valore di utente entra
    // nella query, e il quoting protegge comunque i nomi con caratteri strani.
    const colonne = await prisma.$queryRawUnsafe<Array<{ name: string; type: string }>>(
      `pragma table_info(${ident(name)})`,
    );
    for (const colonna of colonne) {
      if (/TEXT|VARCHAR|CHAR|CLOB/i.test(colonna.type ?? "")) {
        out.push({ tabella: name, colonna: colonna.name });
      }
    }
  }
  return out;
}

/** Il nome del file compare da qualche parte, in una colonna testuale qualunque? */
async function citatoInUnTesto(
  ago: string,
  colonne: Array<{ tabella: string; colonna: string }>,
): Promise<boolean> {
  for (const { tabella, colonna } of colonne) {
    const righe = await prisma.$queryRawUnsafe<Array<{ uno: number }>>(
      `select 1 as uno from ${ident(tabella)} where ${ident(colonna)} like ? limit 1`,
      `%${ago}%`,
    );
    if (righe.length > 0) return true;
  }
  return false;
}

/**
 * Passa il magazzino e toglie i file che nessun record e nessun testo nomina.
 * Con `dryRun` non cancella niente e dice cosa avrebbe tolto.
 */
export async function sweepOrphanFiles(
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<OrphanSweep> {
  const now = opts.now ?? new Date();
  const limite = now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000;
  const store = attachmentStore();
  const esito: OrphanSweep = {
    esaminati: 0,
    riservati: 0,
    referenziati: 0,
    recenti: 0,
    rimandati: 0,
    rimossi: [],
    byte: 0,
  };

  const files = await store.list();
  esito.esaminati = files.length;

  const inTabella = new Set(
    (
      await prisma.attachment.findMany({ where: { path: { not: null } }, select: { path: true } })
    ).map((a) => a.path!.replace(/^\/+/, "")),
  );

  const candidati: typeof files = [];
  for (const file of files) {
    if (RISERVATI.some((prefisso) => file.key.startsWith(prefisso))) {
      esito.riservati += 1;
      continue;
    }
    if (inTabella.has(file.key)) {
      esito.referenziati += 1;
      continue;
    }
    if (file.writtenAt.getTime() > limite) {
      esito.recenti += 1;
      continue;
    }
    candidati.push(file);
  }

  if (candidati.length > MAX_CANDIDATI) {
    esito.rimandati = candidati.length - MAX_CANDIDATI;
    candidati.length = MAX_CANDIDATI;
  }

  if (candidati.length > 0) {
    const colonne = await colonneTestuali();
    for (const file of candidati) {
      const ago = file.key.split("/").pop() ?? file.key;
      if (await citatoInUnTesto(ago, colonne)) {
        esito.referenziati += 1;
        continue;
      }
      if (!opts.dryRun) await store.remove(file.key);
      esito.rimossi.push(file.key);
      esito.byte += file.size;
    }
  }

  return esito;
}
