// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { PluginUiEntry } from "@kancrm/shared";

/**
 * **Dove va la voce di un plugin nel menù.**
 *
 * Fino al 05/09/2026 i plugin stavano in coda alle aree e li vedevano tutti.
 * «Personale» — che sta fra le aree, dopo Bacheche, per i soli interni — non
 * aveva modo di dirlo. Ora il manifesto lo dice (`sezione`, `dopo`, `ruoli`,
 * `soloManager`) e qui si applica: una funzione pura, senza React, perché è la
 * regola che conta e si prova da sola.
 *
 * `dopo` può nominare un'area (la sua chiave) o un altro plugin (il suo nome):
 * se non esiste, la voce va in coda — il server ha già avvisato nel log, e un
 * menù non si rompe per un nome sbagliato. Due plugin che chiedono lo stesso
 * posto restano nell'ordine in cui sono montati (l'ordine di `PLUGINS`).
 */
export interface VoceNativa {
  /** La chiave con cui un plugin può dire «dopo di me»: `tasks`, `deals`… */
  chiave: string;
}

export interface Osservatore {
  role: string;
  isManager: boolean;
}

/**
 * Il plugin lo vede chi il manifesto ammette.
 *
 * `soloGruppo` è l'unico filtro che **il browser non calcola**: se chi guarda
 * sta nel gruppo del plugin lo sa il server, che ha i membri, e lo scrive in
 * `nelGruppo` a ogni richiesta. Qui si applica soltanto — e quando la
 * risposta non c'è (null, un core più vecchio) la voce resta: meglio una
 * voce di troppo che un'area che sparisce senza spiegazione.
 */
export function vedeIlPlugin(plugin: PluginUiEntry, utente: Osservatore): boolean {
  if (!plugin.menu) return false;
  if (plugin.ruoli && !plugin.ruoli.includes(utente.role)) return false;
  if (plugin.soloManager && !utente.isManager) return false;
  if (plugin.soloGruppo && plugin.nelGruppo === false) return false;
  return true;
}

/** Una voce disposta: nativa (con quello che il chiamante le ha attaccato) o di plugin. */
export type VoceDisposta<T extends VoceNativa> =
  | { chiave: string; nativa: T; plugin?: undefined }
  | { chiave: string; nativa?: undefined; plugin: PluginUiEntry };

/**
 * Le voci della sezione, native e plugin insieme, nell'ordine finale. La
 * chiave identifica la voce (l'area o il nome del plugin); la voce nativa
 * torna intera, così chi disegna non deve ritrovarla.
 */
export function disponiVoci<T extends VoceNativa>(
  native: T[],
  plugins: PluginUiEntry[],
  sezione: PluginUiEntry["sezione"],
  utente: Osservatore,
): Array<VoceDisposta<T>> {
  const risultato: Array<VoceDisposta<T>> = native.map((v) => ({ chiave: v.chiave, nativa: v }));
  const daPosizionare = plugins.filter((p) => p.sezione === sezione && vedeIlPlugin(p, utente));

  /**
   * In due giri: prima chi si aggancia a una voce nativa o va in coda, poi chi
   * si aggancia a un altro plugin — che a quel punto ha già un posto. Un
   * aggancio a un plugin non montato (o non visibile a chi guarda) ricade in
   * coda, come un nome sconosciuto.
   */
  const inCoda: PluginUiEntry[] = [];
  const agganciatiAPlugin: PluginUiEntry[] = [];
  for (const plugin of daPosizionare) {
    const posizione = plugin.dopo ? risultato.findIndex((v) => v.chiave === plugin.dopo) : -1;
    if (posizione >= 0) {
      risultato.splice(posizione + 1, 0, { chiave: plugin.nome, plugin });
    } else if (plugin.dopo && daPosizionare.some((p) => p.nome === plugin.dopo)) {
      agganciatiAPlugin.push(plugin);
    } else {
      inCoda.push(plugin);
    }
  }
  for (const plugin of agganciatiAPlugin) {
    const posizione = risultato.findIndex((v) => v.chiave === plugin.dopo);
    if (posizione >= 0) risultato.splice(posizione + 1, 0, { chiave: plugin.nome, plugin });
    else inCoda.push(plugin);
  }
  for (const plugin of inCoda) risultato.push({ chiave: plugin.nome, plugin });
  return risultato;
}
