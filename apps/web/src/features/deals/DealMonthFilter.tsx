// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { SENZA_DATA } from "@kancrm/shared";
import { MultiFilterSelect } from "@/components/ui/multi-filter-select";
import { localeTag } from "@/lib/i18n";

/** "settembre 2026", o la voce delle offerte senza data. */
export function useDealMonthLabel() {
  const { t } = useTranslation();
  return (key: string, conAnno = true) =>
    key === SENZA_DATA
      ? t("Chiusura non impostata")
      : new Intl.DateTimeFormat(localeTag(), {
          month: "long",
          ...(conAnno ? { year: "numeric" } : {}),
        }).format(new Date(`${key}-01T12:00:00Z`));
}

/**
 * **Il filtro per mese di chiusura** (03/10/2026): più mesi insieme, raggruppati
 * per anno (l'intestazione dell'anno li spunta tutti), e in fondo le offerte con
 * la chiusura non impostata. Il mese è quello di `dealMonthKey`. Lo stesso
 * componente nella pagina Offerte e nel pannello investitori.
 */
export function DealMonthFilter({
  months,
  selected,
  onChange,
}: {
  /** I mesi presenti nei dati, con quante offerte (senza-data in fondo). */
  months: Array<{ key: string; count: number }>;
  selected: readonly string[];
  onChange: (months: string[]) => void;
}) {
  const { t } = useTranslation();
  const etichetta = useDealMonthLabel();
  // Un mese ricordato che oggi non ha offerte resta in elenco (a zero): così
  // lo si vede spuntato e lo si può togliere.
  const presenti = new Map(months.map((m) => [m.key, m.count]));
  for (const key of selected) if (!presenti.has(key)) presenti.set(key, 0);
  const chiavi = [...presenti.keys()].sort((a, b) =>
    a === SENZA_DATA ? 1 : b === SENZA_DATA ? -1 : a.localeCompare(b),
  );
  return (
    <MultiFilterSelect
      icon="period"
      label={t("Filtra per mese di chiusura")}
      allLabel={t("Tutti i mesi")}
      className="w-44"
      summary={(scelte) =>
        scelte.length === 1
          ? etichetta(scelte[0]!.value)
          : t("{{count}} mesi", { count: scelte.length })
      }
      options={chiavi.map((key) => ({
        value: key,
        label: key === SENZA_DATA ? etichetta(key) : etichetta(key, false),
        count: presenti.get(key),
        group: key === SENZA_DATA ? undefined : key.slice(0, 4),
        className: key === SENZA_DATA ? undefined : "capitalize",
      }))}
      selected={selected}
      onChange={onChange}
    />
  );
}
