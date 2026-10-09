import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface InlineSelectOption {
  value: string;
  label: string;
}

/** Voci raggruppate sotto un'intestazione (optgroup): stesse tendine del dettaglio. */
export interface InlineSelectGroup {
  label: string;
  options: InlineSelectOption[];
}

interface InlineSelectProps {
  /** Contenuto mostrato quando la cella non è in modifica (badge, testo, …). */
  children: ReactNode;
  value: string | null;
  /** Voci semplici; in alternativa `groups` per le tendine divise per categoria. */
  options?: InlineSelectOption[];
  groups?: InlineSelectGroup[];
  onChange: (value: string) => void;
  /** Sola lettura: mostra solo `children`, senza interazione. */
  readOnly?: boolean;
  /** Voce iniziale per i campi che ammettono "nessun valore" (es. assegnatario). */
  emptyLabel?: string;
  title?: string;
  className?: string;
}

/**
 * Cella di lista modificabile al click: mostra un valore e, al clic, lo sostituisce
 * con una combo per cambiarlo al volo senza aprire il dettaglio.
 *
 * Tutti gli eventi fermano la propagazione perché queste celle vivono dentro righe
 * cliccabili (che aprirebbero il drawer) e dentro menu contestuali.
 */
export function InlineSelect({
  children,
  value,
  options,
  groups,
  onChange,
  readOnly = false,
  emptyLabel,
  title,
  className,
}: InlineSelectProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  if (readOnly) return <>{children}</>;

  if (!editing) {
    return (
      <button
        type="button"
        className={
          className ??
          "rounded-full transition-shadow hover:shadow-[0_0_0_2px] hover:shadow-ring/40"
        }
        title={title ?? t("Clicca per cambiare")}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <select
      autoFocus
      className="h-8 max-w-[12rem] rounded-md border bg-background px-1.5 text-sm"
      defaultValue={value ?? ""}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        if (e.target.value !== (value ?? "")) onChange(e.target.value);
        setEditing(false);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setEditing(false);
        }
      }}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {(groups ?? []).map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
