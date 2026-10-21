// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { VisibilityScope } from "./schemas/deals";

/**
 * **Le funzioni dell'istanza** (17/10/2026): ciò che un'installazione può
 * accendere e spegnere — le aree del nucleo elencate qui, e i moduli
 * dell'edizione, che dichiarano la propria voce nel registro del server. Vedi
 * `plan/funzioni-istanza.md`.
 *
 * Lo stato è l'elenco delle funzioni **spente**: vuoto vuol dire tutto acceso,
 * così un'installazione che non l'ha mai toccato resta com'era.
 */
export interface FunzioneAccendibile {
  /** La chiave: per i moduli è il loro nome nel registro (`ticket`, `timesheet`…). */
  chiave: string;
  /** In italiano, che è la chiave delle traduzioni. */
  etichetta: string;
  descrizione: string;
  /** Le funzioni senza le quali questa non ha senso: spente quelle, è spenta anche lei. */
  richiede: readonly string[];
  /** Lo scope di gruppo che la funzione porta: con lei spenta non vale per nessuno. */
  scope: VisibilityScope | null;
}

/**
 * Le aree del nucleo che si possono spegnere. **Lo scadenzario no**: è il cuore
 * di ogni installazione, e ci arrivano le automazioni (offerta vinta →
 * fatturazione, le integrazioni).
 */
export const FUNZIONI_DEL_NUCLEO: readonly FunzioneAccendibile[] = [
  {
    chiave: "offerte",
    etichetta: "Offerte",
    descrizione: "Pipeline commerciale, fasi, forecast e la loro area per i gruppi.",
    richiede: [],
    scope: VisibilityScope.DEALS,
  },
  {
    chiave: "contatti",
    etichetta: "Persone (contatti)",
    descrizione: "Le persone del CRM. Le aziende restano: servono ai task.",
    richiede: [],
    scope: VisibilityScope.CONTACTS,
  },
  {
    chiave: "progetti",
    etichetta: "Progetti",
    descrizione: "Progetti, membri e task di progetto.",
    richiede: [],
    scope: VisibilityScope.PROJECTS,
  },
  {
    chiave: "ore",
    etichetta: "Ore",
    descrizione: "La griglia del timesheet.",
    richiede: [],
    scope: null,
  },
  {
    chiave: "andamento",
    etichetta: "L'andamento",
    descrizione: "Il pannello dell'area tecnica in «La mia giornata».",
    richiede: [],
    scope: null,
  },
];

/**
 * **Spente in effetti**: quelle spente a mano più quelle che dipendono, anche
 * di più passi, da una spenta. Le chiavi spente che non sono nel catalogo
 * restano nell'elenco: un modulo che questa edizione non ha non si accende per
 * essere stato dimenticato in un elenco.
 */
export function funzioniSpenteEffettive(
  spente: Iterable<string>,
  catalogo: readonly Pick<FunzioneAccendibile, "chiave" | "richiede">[],
): Set<string> {
  const risultato = new Set(spente);
  let cambiato = true;
  while (cambiato) {
    cambiato = false;
    for (const funzione of catalogo) {
      if (risultato.has(funzione.chiave)) continue;
      if (funzione.richiede.some((chiave) => risultato.has(chiave))) {
        risultato.add(funzione.chiave);
        cambiato = true;
      }
    }
  }
  return risultato;
}

/**
 * Perché una funzione è spenta senza esserlo a mano: le funzioni spente da cui
 * dipende, direttamente o no. Vuoto se è accesa o se l'ha spenta qualcuno.
 */
export function spentaPerColpaDi(
  chiave: string,
  spente: ReadonlySet<string>,
  catalogo: readonly Pick<FunzioneAccendibile, "chiave" | "richiede">[],
): string[] {
  if (spente.has(chiave)) return [];
  const perChiave = new Map(catalogo.map((funzione) => [funzione.chiave, funzione]));
  const colpevoli = new Set<string>();
  const visitate = new Set<string>();
  const visita = (attuale: string) => {
    if (visitate.has(attuale)) return;
    visitate.add(attuale);
    for (const dipendenza of perChiave.get(attuale)?.richiede ?? []) {
      if (spente.has(dipendenza)) colpevoli.add(dipendenza);
      else visita(dipendenza);
    }
  };
  visita(chiave);
  return [...colpevoli];
}

/** Una voce della sezione «Funzioni» della pagina Sistema. */
export const funzioneIstanzaSchema = z.object({
  chiave: z.string(),
  etichetta: z.string(),
  descrizione: z.string(),
  tipo: z.enum(["nucleo", "modulo"]),
  richiede: z.array(z.string()),
  scope: z.nativeEnum(VisibilityScope).nullable(),
  /** Spenta a mano dall'amministratore. */
  spenta: z.boolean(),
  /** Spenta perché lo sono queste (vuoto se accesa o spenta a mano). */
  spentaDa: z.array(z.string()),
});
export type FunzioneIstanza = z.infer<typeof funzioneIstanzaSchema>;

export const setFunzioniSpenteInput = z.object({
  spente: z.array(z.string().min(1).max(64)).max(100),
});
export type SetFunzioniSpenteInput = z.infer<typeof setFunzioniSpenteInput>;
