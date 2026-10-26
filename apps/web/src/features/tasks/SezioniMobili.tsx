// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * **La barra delle sezioni, solo sul telefono** (`sm:hidden`).
 *
 * A tutta pagina un pannello non ha spazio per due regioni: ancorare la chat in
 * fondo lascia ai campi mezzo schermo — o meno (25/10/2026, l'offerta sul
 * telefono: Trattativa schiacciata in alto, mezza pagina vuota sotto la chat).
 * Una barra sul bordo di sotto è l'unico comando che si raggiunge senza cambiare
 * presa, ed è dove sta in ogni applicazione che si usa con una mano sola.
 *
 * Sopra `sm` sparisce del tutto e resta il pannello per intero: **non due
 * versioni da tenere allineate**, una che si richiude — la stessa scelta di
 * `mobile-filters`. Nata nel pannello del task (20/08/2026), sta qui perché la
 * usano tutti i pannelli con la conversazione ancorata (`ChatDock`).
 */
export type SezioneMobile = "contesto" | "stato" | "contenuto" | "conversazione";

/** I toni sono quelli delle bande (`PanelGroup`): la barra parla lo stesso colore. */
const TONI: Record<SezioneMobile, string> = {
  contesto: "text-rose-600 dark:text-rose-400",
  stato: "text-sky-600 dark:text-sky-400",
  contenuto: "text-emerald-600 dark:text-emerald-400",
  conversazione: "text-violet-600 dark:text-violet-400",
};

export interface VoceSezione {
  id: SezioneMobile;
  /** In italiano, chiave della traduzione: «Trattativa» dove il task dice «Contesto». */
  etichetta: string;
}

/** Le sezioni del task: il pannello più ricco, e il modello degli altri. */
export const SEZIONI_DEL_TASK: readonly VoceSezione[] = [
  { id: "contesto", etichetta: "Contesto" },
  { id: "stato", etichetta: "Stato" },
  { id: "contenuto", etichetta: "Contenuto" },
  { id: "conversazione", etichetta: "Chat" },
];

/**
 * La sezione che si guarda sul telefono, e la classe che nasconde le altre
 * (`mostra("stato")` è vuota se tocca a lei, `max-sm:hidden` se no). Sopra
 * `sm` le classi `max-sm:` non valgono e si vede tutto.
 */
export function useSezioneMobile(iniziale: SezioneMobile = "contesto") {
  const [sezione, setSezione] = useState<SezioneMobile>(iniziale);
  const mostra = (quale: SezioneMobile) => (sezione === quale ? "" : "max-sm:hidden");
  return { sezione, setSezione, mostra };
}

export function SezioniMobili({
  sezioni = SEZIONI_DEL_TASK,
  valore,
  onChange,
  commenti,
}: {
  sezioni?: readonly VoceSezione[];
  valore: SezioneMobile;
  onChange: (s: SezioneMobile) => void;
  commenti: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-none gap-1.5 border-t px-2 py-1.5 sm:hidden" role="tablist">
      {sezioni.map((sezione) => {
        const attiva = sezione.id === valore;
        return (
          <button
            key={sezione.id}
            type="button"
            role="tab"
            aria-selected={attiva}
            onClick={() => onChange(sezione.id)}
            // 40px di altezza: il dito non è un puntatore (convenzione UI).
            className={cn(
              "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium",
              attiva ? cn("bg-muted", TONI[sezione.id]) : "text-muted-foreground",
            )}
          >
            {t(sezione.etichetta)}
            {sezione.id === "conversazione" && commenti > 0 && (
              <span className="text-[11px] opacity-70">{commenti}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
