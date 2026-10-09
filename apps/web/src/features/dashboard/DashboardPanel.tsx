import type { ReactNode } from "react";
import { ChevronDown, GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSortableColumn } from "@/features/kanban/useColumnOrder";
import { cn } from "@/lib/utils";

/**
 * **Un riquadro della giornata**, uguale per tutti: a sinistra la maniglia
 * per spostarlo, poi icona e titolo, le pastiglie che fanno da filtro, e in
 * fondo a destra il bottone per chiuderlo lasciando in vista solo la barra
 * (07/09/2026). Disposizione e riquadri chiusi si ricordano nel browser
 * (`layout.ts`), come ogni altra scelta dell'applicazione.
 *
 * La maniglia è l'unico attivatore del trascinamento: le righe dentro sono
 * bottoni, e un clic su un task non deve mai diventare l'inizio di uno
 * spostamento. Stesso `useSortableColumn` delle colonne della kanban.
 */
export function DashboardPanel({
  id,
  title,
  icon,
  tone,
  chips,
  collapsed,
  onCollapsed,
  children,
}: {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  tone?: "danger";
  /** Le pastiglie (o altro) accanto al titolo: miei / supervisionati / personali. */
  chips?: ReactNode;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, style, isDragging, handleProps } = useSortableColumn(id);
  return (
    <section
      ref={setNodeRef}
      style={style}
      data-riquadro={id}
      className={cn(
        "rounded-lg border bg-card p-4",
        tone === "danger" && "border-destructive/40",
        isDragging && "opacity-60 shadow-lg",
      )}
    >
      <h3
        className={cn(
          "flex flex-wrap items-center gap-1.5 text-sm font-semibold",
          !collapsed && "mb-3",
        )}
      >
        <button
          type="button"
          {...handleProps}
          className="-ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          aria-label={t("Sposta il riquadro")}
          title={t("Sposta il riquadro")}
        >
          <GripVertical className="size-4" />
        </button>
        {icon}
        {title}
        {chips}
        <button
          type="button"
          className="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-expanded={!collapsed}
          title={collapsed ? t("Apri la sezione") : t("Chiudi la sezione")}
          onClick={() => onCollapsed(!collapsed)}
        >
          <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
        </button>
      </h3>
      {!collapsed && children}
    </section>
  );
}
