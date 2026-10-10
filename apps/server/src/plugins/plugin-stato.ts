// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "../db";

/**
 * **Quali plugin sono spenti** (22/09/2026).
 *
 * Un plugin si *installa* mettendolo in `PLUGINS` nel `.env` e riavviando: è
 * lì che il core lo carica, e le rotte di Fastify non si aggiungono a server
 * avviato. Si *spegne* invece da Sistema, subito e senza riavvio: resta
 * caricato, ma il porta-plugin smette di servirlo — le sue pagine e le sue API
 * rispondono «disattivato», la voce sparisce dal menù, le ancore dalle pagine,
 * il contributo dal riepilogo del mattino. Riacceso, torna com'era: dati,
 * tabelle e configurazione non si toccano mai.
 *
 * Quello che il plugin fa **da sé in sottofondo** (un indice che si ricostruisce,
 * un timer suo) si ferma al riavvio successivo: il core non ha una porta per
 * fermarlo prima, e far finta di sì sarebbe peggio che dirlo.
 *
 * La scelta sta in `AppSetting`, perché deve sopravvivere a un riavvio e a un
 * deploy; qui se ne tiene una copia in memoria, perché la si legge a ogni
 * richiesta rivolta a un plugin.
 */
const CHIAVE = "plugins.disattivati";
let disattivati = new Set<string>();

function leggi(valore: string | null | undefined): Set<string> {
  if (!valore) return new Set();
  try {
    const elenco: unknown = JSON.parse(valore);
    return new Set(Array.isArray(elenco) ? elenco.filter((n): n is string => typeof n === "string") : []);
  } catch {
    // un valore rovinato non deve spegnere niente: meglio tutti accesi che il buio
    return new Set();
  }
}

/** All'avvio: rilegge dal database quali plugin erano spenti. */
export async function caricaStatoPlugin(): Promise<void> {
  const riga = await prisma.appSetting.findUnique({ where: { key: CHIAVE } });
  disattivati = leggi(riga?.value);
}

export function pluginDisattivato(nome: string): boolean {
  return disattivati.has(nome);
}

export function pluginSpenti(): string[] {
  return [...disattivati].sort();
}

/** Accende o spegne un plugin, subito. Ritorna lo stato scritto. */
export async function impostaPluginAttivo(nome: string, attivo: boolean): Promise<boolean> {
  const prossimi = new Set(disattivati);
  if (attivo) prossimi.delete(nome);
  else prossimi.add(nome);
  const valore = JSON.stringify([...prossimi].sort());
  await prisma.appSetting.upsert({
    where: { key: CHIAVE },
    create: { key: CHIAVE, value: valore },
    update: { value: valore },
  });
  disattivati = prossimi;
  return attivo;
}
