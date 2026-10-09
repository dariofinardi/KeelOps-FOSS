import { useTranslation } from "react-i18next";
import { BadgeCheck, CalendarClock, FolderKanban, HandCoins, LayoutGrid } from "lucide-react";
import { ACTIVITY_CATEGORY_LABELS, ActivityCategory } from "@kancrm/shared";
import { Button } from "@/components/ui/button";

/**
 * Il segno di ciascuna area di lavoro, in UN punto: gli stessi simboli che gli
 * elenchi usano per la natura dei task (calendario = amministrativa, monete =
 * commerciale, cartelle di progetto = tecnica). Un'icona nuova si aggiunge qui
 * e vale ovunque l'area si scelga.
 */
export const AREA_ICONS: Record<ActivityCategory, typeof CalendarClock> = {
  [ActivityCategory.ADMIN]: CalendarClock,
  [ActivityCategory.SALES]: HandCoins,
  [ActivityCategory.DEV]: FolderKanban,
  [ActivityCategory.QUALITY]: BadgeCheck,
  [ActivityCategory.GENERAL]: LayoutGrid,
};

export interface AreaPickerItem {
  category: ActivityCategory;
  /** Quanti task ci sono (mostrato accanto all'icona quando > 0). */
  count?: number;
}

/**
 * Selettore d'area a pulsanti-icona (compatti, tooltip col nome per esteso).
 *
 * Due mestieri con la stessa faccia: nelle viste agenda/tabella è un FILTRO e
 * offre "Tutte" (le righe portano lo stato, mescolarle si può); nel kanban
 * SCEGLIE la bacheca e "Tutte" non esiste — ogni area ha le sue colonne.
 */
export function AreaPicker({
  items,
  value,
  onChange,
  includeAll = false,
}: {
  items: AreaPickerItem[];
  /** "" = tutte (solo con includeAll). */
  value: ActivityCategory | "";
  onChange: (value: ActivityCategory | "") => void;
  includeAll?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex rounded-md border p-0.5" role="group" aria-label={t("Area di lavoro")}>
      {includeAll && (
        <Button
          variant={value === "" ? "default" : "ghost"}
          size="sm"
          title={t("Tutte le aree")}
          aria-pressed={value === ""}
          onClick={() => onChange("")}
        >
          <LayoutGrid className="size-4" />
        </Button>
      )}
      {items.map(({ category, count }) => {
        const Icon = AREA_ICONS[category];
        return (
          <Button
            key={category}
            variant={value === category ? "default" : "ghost"}
            size="sm"
            title={t(ACTIVITY_CATEGORY_LABELS[category])}
            aria-pressed={value === category}
            onClick={() => onChange(category)}
          >
            <Icon className="size-4" />
            {count !== undefined && count > 0 && <span className="text-xs">{count}</span>}
          </Button>
        );
      })}
    </div>
  );
}
