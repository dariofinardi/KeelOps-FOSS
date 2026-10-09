import { useTranslation } from "react-i18next";
import type { TimesheetUser } from "@kancrm/shared";
import { MultiFilterSelect } from "@/components/ui/multi-filter-select";

/**
 * Selezione multipla di utenti a checkbox (dropdown). Nessuno selezionato = stato
 * "tutti"/"il mio" a seconda di `allLabel` (la semantica la decide chi lo usa). I
 * disattivati sono mostrati in rosso. La tendina è quella comune dei filtri a
 * scelta multipla (`MultiFilterSelect`).
 */
export function UserMultiSelect({
  users,
  selected,
  onChange,
  allLabel,
}: {
  users: TimesheetUser[];
  selected: string[];
  onChange: (ids: string[]) => void;
  allLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <MultiFilterSelect
      icon="people"
      label={allLabel}
      allLabel={allLabel}
      className="min-w-44"
      summary={(scelti) => t("{{count}} utenti", { count: scelti.length })}
      options={users.map((u) => ({
        value: u.id,
        label: `${u.name}${u.isActive ? "" : ` ${t("(disatt.)")}`}`,
        className: u.isActive ? undefined : "text-red-600",
      }))}
      selected={selected}
      onChange={onChange}
    />
  );
}
