import { DUE_RANGE_OPTIONS } from "@kancrm/shared";
import { useTranslation } from "react-i18next";
import { FilterSelect } from "@/components/ui/filter-select";

/**
 * Tendina del range di scadenza, uguale in tutte le liste: scaduti + entro N
 * giorni; i task senza data si rivedono scegliendo "Tutte". Compatta di
 * proposito — l'icona dice di cosa parla, il tooltip spiega la regola.
 *
 * Usa la scatola condivisa dei filtri (`FilterSelect`): era lei l'originale di
 * quella forma — icona più tendina dentro un `<label>` — e tenerne una copia
 * qui avrebbe voluto dire due cronometri diversi al primo ritocco.
 */
export function DueRangeSelect({
  value,
  onChange,
}: {
  /** null = nessun range (tutte). */
  value: number | null;
  onChange: (days: number | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <FilterSelect
      icon="dueRange"
      label={t("Mostra i task scaduti e quelli in scadenza entro il periodo scelto")}
      value={value === null ? "" : String(value)}
      onChange={(days) => onChange(days === "" ? null : Number(days))}
    >
      <option value="">{t("Tutte")}</option>
      {DUE_RANGE_OPTIONS.map((days) => (
        <option key={days} value={days}>
          {t("{{count}} gg", { count: days })}
        </option>
      ))}
    </FilterSelect>
  );
}
