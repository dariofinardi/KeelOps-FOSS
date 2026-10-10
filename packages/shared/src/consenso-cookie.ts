// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **La scelta sui cookie, una sola per keelops.it e per la demo** (18/09/2026).
 *
 * Chi accetta (o rifiuta) le statistiche sul sito non deve sentirsi fare la
 * stessa domanda entrando nella demo, e viceversa: è la stessa persona, sullo
 * stesso dominio, per lo stesso Google Analytics. La scelta sta quindi in un
 * cookie sul dominio di primo livello (`Domain=.keelops.it`), che leggono e
 * scrivono tutti e due:
 *
 * - il **sito** (`website/sito/sito.js`, JavaScript senza dipendenze: il
 *   formato è ripetuto là, e questo file è quello di riferimento);
 * - la **demo**, nel browser (`lib/analytics.ts`) e sul server, che manda a
 *   GA gli endpoint solo a chi ha detto sì (`modules/analytics/ga.ts`).
 *
 * Il valore è JSON codificato: `id` lega le scelte della stessa persona nel
 * registro dei consensi, `v` è la versione dell'informativa — cambiandola si
 * richiede a tutti —, `s` e `m` le due finalità (statistiche, pubblicità),
 * `t` il momento della scelta. Il cookie dello «resta connesso» della demo è
 * un'altra cosa (quanto dura la sessione) e resta suo.
 */

export const CONSENSO_COOKIE = "keelops_cookie";

/**
 * La versione dell'informativa. **Deve essere la stessa di `VERSIONE` in
 * `website/sito/sito.js`**: una scelta fatta su una versione più vecchia non
 * vale, e il sito e la demo la richiedono insieme.
 */
export const VERSIONE_INFORMATIVA = "2026-09-18";

/** L'indirizzo del registro dei consensi (il servizio delle iscrizioni del sito). */
export const REGISTRO_CONSENSI = "https://subscribe.keelops.it/api/consensi";

export interface SceltaCookie {
  id: string;
  v: string;
  /** Statistiche (Google Analytics). */
  s: boolean;
  /** Pubblicità (Google Ads): la chiede il sito; la demo la conserva com'è. */
  m: boolean;
  /** Quando è stata fatta, ISO. */
  t: string;
}

/** Il valore del cookie, o `null` se manca, è rotto o è di un'altra versione. */
export function leggiSceltaCookie(valore: string | undefined | null): SceltaCookie | null {
  if (!valore) return null;
  try {
    const dati = JSON.parse(decodeURIComponent(valore)) as Partial<SceltaCookie>;
    if (typeof dati.id !== "string" || dati.v !== VERSIONE_INFORMATIVA) return null;
    return {
      id: dati.id.slice(0, 64),
      v: dati.v,
      s: dati.s === true,
      m: dati.m === true,
      t: typeof dati.t === "string" ? dati.t : "",
    };
  } catch {
    return null;
  }
}

export function scriviSceltaCookie(scelta: SceltaCookie): string {
  return encodeURIComponent(JSON.stringify(scelta));
}

/**
 * Il dominio su cui scrivere: quello di primo livello quando si è sotto
 * keelops.it (il sito e la demo lo condividono), altrimenti nessuno — in
 * sviluppo e sulle installazioni che non sono nostre il cookie resta
 * dell'host, e non si prova a scrivere dove il browser rifiuterebbe.
 */
export function dominioCondiviso(hostname: string): string | null {
  return hostname === "keelops.it" || hostname.endsWith(".keelops.it") ? ".keelops.it" : null;
}

/** L'etichetta per il registro, con la stessa regola del sito: togliere un sì è una revoca. */
export function etichettaScelta(
  prima: Pick<SceltaCookie, "s" | "m"> | null,
  dopo: Pick<SceltaCookie, "s" | "m">,
): "accettato" | "rifiutato" | "parziale" | "revocato" {
  if ((prima?.s && !dopo.s) || (prima?.m && !dopo.m)) return "revocato";
  if (dopo.s && dopo.m) return "accettato";
  if (!dopo.s && !dopo.m) return "rifiutato";
  return "parziale";
}
