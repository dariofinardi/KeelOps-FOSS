// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { arrayMove } from "@dnd-kit/sortable";

/**
 * **La disposizione dei riquadri della giornata**, ricordata nel browser.
 *
 * Due colonne (una sola sul telefono, in questo ordine), ogni riquadro con
 * una maniglia per spostarlo e un bottone per chiuderlo (07/09/2026). Lo
 * stato è un elenco di identificatori per colonna più i riquadri chiusi:
 * niente altro, così una versione che aggiunge o toglie un riquadro non
 * rompe quello che l'utente ha salvato — `normalizzaLayout` scarta gli
 * sconosciuti e accoda i nuovi al loro posto di serie.
 *
 * I riquadri che in un dato momento non ci sono (niente task domani, nessuna
 * offerta visibile, il plugin che dice di essere vuoto) restano nella
 * disposizione al loro posto: torneranno lì quando avranno qualcosa.
 */
export type ColonnaGiornata = "sinistra" | "destra";

export interface LayoutGiornata {
  sinistra: string[];
  destra: string[];
  /** Riquadri chiusi (solo l'intestazione in vista). */
  chiusi: Record<string, boolean>;
}

export const RIQUADRI_DI_SERIE: LayoutGiornata = {
  sinistra: ["overdue", "dueToday", "dueTomorrow", "nextDays", "noDueDate", "byStatus"],
  destra: ["unassigned", "deals", "tickets"],
  // "Senza scadenza" è lungo per costruzione: nasce chiuso, con i contatori in vista.
  chiusi: { noDueDate: true },
};

export const colonnaDi = (layout: LayoutGiornata, id: string): ColonnaGiornata | null =>
  layout.sinistra.includes(id) ? "sinistra" : layout.destra.includes(id) ? "destra" : null;

/**
 * Quello che si è salvato, reso valido contro i riquadri che esistono ora:
 * via gli sconosciuti e i doppioni, dentro i mancanti nella colonna di serie
 * (i plugin, che di serie non hanno un posto, in fondo a sinistra).
 */
export function normalizzaLayout(
  salvato: Partial<LayoutGiornata> | null | undefined,
  conosciuti: string[],
  diSerie: LayoutGiornata = RIQUADRI_DI_SERIE,
): LayoutGiornata {
  const validi = new Set(conosciuti);
  const visti = new Set<string>();
  const pulisci = (ids: unknown): string[] => {
    if (!Array.isArray(ids)) return [];
    const out: string[] = [];
    for (const id of ids) {
      if (typeof id !== "string" || !validi.has(id) || visti.has(id)) continue;
      visti.add(id);
      out.push(id);
    }
    return out;
  };
  const sinistra = pulisci(salvato?.sinistra);
  const destra = pulisci(salvato?.destra);
  for (const id of conosciuti) {
    if (visti.has(id)) continue;
    visti.add(id);
    if (diSerie.destra.includes(id)) destra.push(id);
    else sinistra.push(id);
  }
  const chiusi: Record<string, boolean> = { ...diSerie.chiusi };
  if (salvato?.chiusi && typeof salvato.chiusi === "object") {
    for (const [id, valore] of Object.entries(salvato.chiusi)) {
      if (validi.has(id) && typeof valore === "boolean") chiusi[id] = valore;
    }
  }
  return { sinistra, destra, chiusi };
}

/** Il riquadro `id` va nella colonna `colonna`, prima di `primaDi` (o in fondo). */
export function spostaRiquadro(
  layout: LayoutGiornata,
  id: string,
  colonna: ColonnaGiornata,
  primaDi: string | null,
): LayoutGiornata {
  if (id === primaDi) return layout;
  const sinistra = layout.sinistra.filter((x) => x !== id);
  const destra = layout.destra.filter((x) => x !== id);
  const target = colonna === "sinistra" ? sinistra : destra;
  const indice = primaDi ? target.indexOf(primaDi) : -1;
  if (indice < 0) target.push(id);
  else target.splice(indice, 0, id);
  return { ...layout, sinistra, destra };
}

/** Riordino dentro la stessa colonna, come una kanban: `attivo` prende il posto di `sopra`. */
export function riordinaRiquadri(
  layout: LayoutGiornata,
  attivo: string,
  sopra: string,
): LayoutGiornata {
  const colonna = colonnaDi(layout, attivo);
  if (!colonna || colonna !== colonnaDi(layout, sopra) || attivo === sopra) return layout;
  const ids = layout[colonna];
  const mossi = arrayMove(ids, ids.indexOf(attivo), ids.indexOf(sopra));
  return { ...layout, [colonna]: mossi };
}

export function chiudiRiquadro(
  layout: LayoutGiornata,
  id: string,
  chiuso: boolean,
): LayoutGiornata {
  return { ...layout, chiusi: { ...layout.chiusi, [id]: chiuso } };
}
