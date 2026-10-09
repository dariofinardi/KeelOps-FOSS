import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ACTIVITY_CATEGORY_LABELS,
  ActivityCategory,
  moduleCategory,
  type ActivityType,
  type ActivityTypeRef,
} from "@kancrm/shared";
import { useInternalLists } from "@/features/auth/useAuth";
import { api } from "@/lib/api";
import { ColorPill } from "@/components/ui/color-pill";

export function useActivityTypes() {
  const enabled = useInternalLists();
  return useQuery({
    queryKey: ["activity-types"],
    queryFn: () => api<ActivityType[]>("/api/activity-types"),
    staleTime: 5 * 60_000,
    enabled,
  });
}

const CATEGORY_ORDER: ActivityCategory[] = [
  ActivityCategory.ADMIN,
  ActivityCategory.SALES,
  ActivityCategory.DEV,
  ActivityCategory.GENERAL,
];

export interface ActivityTypeGroup {
  category: ActivityCategory;
  label: string;
  items: ActivityType[];
}

/**
 * Tipi di attività raggruppati per categoria, nell'ordine in cui vanno mostrati.
 *
 * Unica fonte per **tutte** le tendine dei tipi — quella grande del dettaglio e
 * quella che si apre nelle celle degli elenchi: senza, una mostrava i gruppi e
 * l'altra un elenco piatto di venti voci in cui non si trovava niente.
 *
 * Con `kind` (o `category`) restringe al mestiere del modulo più i **Generali**,
 * che sono trasversali. Il tipo già impostato resta comunque in elenco: una
 * tendina che non contiene il proprio valore mostrerebbe "Nessun tipo" e al primo
 * tocco lo cancellerebbe.
 */
export function groupActivityTypes(
  types: ActivityType[] | undefined,
  { value, kind, category }: { value?: string | null; kind?: string; category?: ActivityCategory },
): ActivityTypeGroup[] {
  const own = category ?? (kind ? moduleCategory(kind) : null);
  const current = (types ?? []).find((t) => t.id === value);
  const visible = own
    ? [own, ...(own === ActivityCategory.GENERAL ? [] : [ActivityCategory.GENERAL])]
    : CATEGORY_ORDER;
  const order =
    current && !visible.includes(current.category as ActivityCategory)
      ? [...visible, current.category as ActivityCategory]
      : visible;
  return order
    .map((group) => ({
      category: group,
      label: ACTIVITY_CATEGORY_LABELS[group],
      items: (types ?? []).filter(
        (t) => t.category === group && (visible.includes(group) || t.id === value),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Select del tipo di attività, raggruppato per categoria.
 *
 * Con `kind` mostra solo i tipi del modulo (progetti → sviluppo, offerte →
 * commerciali, scadenzario → amministrative) più quelli **Generali**, che sono
 * trasversali: "Riunione" serve ovunque. Senza `kind` li mostra tutti (pagine di
 * configurazione).
 */
export function ActivityTypeSelect({
  value,
  onChange,
  className,
  emptyLabel,
  kind,
  category,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  emptyLabel?: string;
  /** Modulo del task (TaskKind): restringe le categorie proposte. */
  kind?: string;
  /**
   * Categoria esplicita, che vince sul modulo: serve dove il mestiere non coincide
   * con il modulo — un'attività nata da un'offerta è commerciale anche se il task
   * finisce nello scadenzario.
   */
  category?: ActivityCategory;
}) {
  const { t } = useTranslation();
  const { data: types } = useActivityTypes();
  const byCategory = groupActivityTypes(types, { value, kind, category });

  return (
    <select
      className={className ?? "h-9 rounded-md border bg-background px-2 text-sm"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{emptyLabel ?? t("Nessun tipo")}</option>
      {byCategory.map((group) => (
        <optgroup key={group.category} label={t(group.label)}>
          {group.items.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Piccola pill colorata con il nome del tipo di attività. */
export function ActivityTypeBadge({ type }: { type: ActivityTypeRef }) {
  const { t } = useTranslation();
  return (
    <ColorPill
      color={type.color}
      label={type.name}
      dot="small"
      title={t(ACTIVITY_CATEGORY_LABELS[type.category])}
    />
  );
}
