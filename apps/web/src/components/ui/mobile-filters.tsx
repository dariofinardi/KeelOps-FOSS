// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useListPrefs } from "@/lib/useListPrefs";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * I filtri secondari, richiusi sul telefono (16/08/2026).
 *
 * Sullo schermo di un telefono la barra dei filtri delle Bacheche occupava
 * cinque righe: area, scadenza, persona, stato, tipo, ordinamento, chiusi,
 * azzera. Prima di vedere **un task** bisognava scorrere, e il contenuto —
 * cioè il motivo per cui si è aperta la pagina — cominciava sotto la piega.
 * Qui dentro ci vanno i raffinamenti; fuori restano la vista, l'area e il
 * pulsante che crea, che sono le tre cose che si usano davvero in mobilità.
 *
 * **Da tablet in su non esiste**: `sm:contents` toglie di mezzo il contenitore
 * e i figli tornano a essere elementi diretti della barra, con lo stesso a capo
 * di prima. Nessuna doppia versione della barra da tenere allineata.
 *
 * Il numero sul pulsante è il conto dei filtri attivi: chiuso, dice comunque se
 * la lista che si sta guardando è ristretta — un elenco vuoto senza spiegazione
 * è il modo più veloce per credere che i dati siano spariti.
 */
export function MobileFilters({
  /** Quanti filtri sono attivi ora: si legge sul pulsante anche da chiuso. */
  count = 0,
  /** Chiave di memoria: ogni pagina ricorda la sua scelta (aperto/chiuso). */
  storageKey,
  children,
}: {
  count?: number;
  storageKey: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { prefs, update } = useListPrefs<{ open: boolean }>(storageKey, { open: false });
  return (
    <>
      <Button
        variant={count > 0 ? "default" : "outline"}
        size="sm"
        className="sm:hidden"
        aria-expanded={prefs.open}
        onClick={() => update({ open: !prefs.open })}
      >
        <SlidersHorizontal className="size-4" />
        {t("Filtri")}
        {count > 0 && ` (${count})`}
      </Button>
      <div
        className={cn(
          "w-full flex-wrap items-center gap-2 sm:contents",
          prefs.open ? "flex" : "hidden",
        )}
      >
        {children}
      </div>
    </>
  );
}
