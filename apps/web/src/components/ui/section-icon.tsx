// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Icona di intestazione di una sezione, dentro una pastiglia colorata: le icone
 * restano a contorno (lo stile di tutta l'applicazione), ma il colore le rende
 * un punto di riferimento per l'occhio quando si scorre una pagina lunga fatta
 * di riquadri tutti uguali.
 *
 * Il colore dice **di cosa parla** la sezione, non è decorazione: ambra per la
 * sicurezza, cielo per il calendario e le scadenze, viola per le notifiche e i
 * messaggi, verde per i dati e i contenuti, **rosa per le persone** (assegnato il
 * 20/08/2026 coi gruppi del pannello task: era l'unico tono del registro senza un
 * significato), grigio per il contesto.
 *
 * Lo stesso registro lo usa `PanelGroup`, che colora il filo dei gruppi nei
 * pannelli di dettaglio: due segni diversi per la stessa cosa insegnerebbero
 * qualcosa di falso.
 * Le classi sono scritte per esteso perché Tailwind le raccoglie dal sorgente:
 * costruirle a pezzi (`bg-${tone}-100`) le farebbe sparire dal foglio di stile.
 */
export type SectionTone = "violet" | "amber" | "sky" | "emerald" | "rose" | "slate";

const TONE: Record<SectionTone, string> = {
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  sky: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  rose: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
};

export function SectionIcon({
  tone,
  children,
  className,
}: {
  tone: SectionTone;
  /** L'icona lucide, a contorno come nel resto dell'interfaccia. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
