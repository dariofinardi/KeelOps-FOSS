import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { FILTER_ICONS, type FilterIcon } from "./filter-select";

export interface MultiFilterOption {
  value: string;
  label: ReactNode;
  /** Quanti record: la tendina dice cosa troverai (CLAUDE.md, regola 12). */
  count?: number;
  /** Righe raggruppate (i mesi per anno): l'intestazione spunta tutto il gruppo. */
  group?: string;
  className?: string;
}

/**
 * **La tendina di un filtro a scelta multipla**, con le caselle (03/10/2026).
 *
 * Stessa scatola di `FilterSelect` — icona del filtro, 40px sul telefono e 36
 * da tablet in su — così in fila con le altre tendine non si distingue: la
 * differenza si vede solo aprendola. Nessuna voce spuntata = nessun filtro
 * (`allLabel`), la prima riga del menu ci torna.
 *
 * Con `group` sulle voci il menu le raggruppa, e l'intestazione del gruppo le
 * spunta o le toglie tutte insieme: dodici mesi di un anno non si cliccano uno
 * per uno.
 */
export function MultiFilterSelect({
  icon,
  label,
  allLabel,
  summary,
  options,
  selected,
  onChange,
  className,
}: {
  icon: FilterIcon;
  /** A cosa serve: titolo al passaggio del mouse ed etichetta ARIA. */
  label: string;
  /** Cosa dice la scatola quando non c'è filtro, ed è la prima riga del menu. */
  allLabel: string;
  /** Cosa dice la scatola con delle voci scelte (le voci in ordine di menu). */
  summary: (scelte: MultiFilterOption[]) => string;
  options: MultiFilterOption[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Vicino al bordo destro il menu si apre verso sinistra, invece di uscire dallo schermo.
  const [aDestra, setADestra] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Icon = FILTER_ICONS[icon];
  useEscapeToClose(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const fuori = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fuori);
    return () => document.removeEventListener("mousedown", fuori);
  }, [open]);

  // L'ordine dei valori scelti segue il menu: un filtro salvato si legge uguale.
  const ordina = (values: string[]) =>
    options.map((o) => o.value).filter((v) => values.includes(v));
  const commuta = (value: string) =>
    onChange(
      ordina(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]),
    );
  const scelte = options.filter((o) => selected.includes(o.value));
  const testo = scelte.length === 0 ? allLabel : summary(scelte);

  const gruppi: Array<{ nome: string | undefined; voci: MultiFilterOption[] }> = [];
  for (const option of options) {
    const ultimo = gruppi.at(-1);
    if (ultimo && ultimo.nome === option.group) ultimo.voci.push(option);
    else gruppi.push({ nome: option.group, voci: [option] });
  }
  const commutaGruppo = (voci: MultiFilterOption[]) => {
    const valori = voci.map((v) => v.value);
    const tutte = valori.every((v) => selected.includes(v));
    onChange(
      ordina(
        tutte
          ? selected.filter((v) => !valori.includes(v))
          : [...new Set([...selected, ...valori])],
      ),
    );
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        title={label}
        aria-label={`${label}: ${testo}`}
        aria-expanded={open}
        onClick={() => {
          const box = ref.current?.getBoundingClientRect();
          setADestra(box !== undefined && box.left + 256 > window.innerWidth - 8);
          setOpen((aperto) => !aperto);
        }}
        className={cn(
          "flex h-10 w-full items-center gap-1.5 rounded-md border bg-background px-2 text-sm sm:h-9",
          scelte.length > 0 && "border-primary/50",
        )}
      >
        <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{testo}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <div
          className={cn(
            "absolute z-30 mt-1 max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg",
            aDestra ? "right-0" : "left-0",
          )}
        >
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn(
              "flex w-full items-center rounded px-2 py-2 text-left text-sm hover:bg-muted sm:py-1.5",
              scelte.length === 0 && "font-medium",
            )}
          >
            {allLabel}
          </button>
          {gruppi.map((gruppo, i) => (
            <div key={gruppo.nome ?? `g${i}`} className="border-t pt-1 mt-1">
              {gruppo.nome && (
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted sm:py-1.5">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={gruppo.voci.every((v) => selected.includes(v.value))}
                    ref={(el) => {
                      // A metà: qualche voce del gruppo sì, qualcuna no.
                      if (el) {
                        const alcune = gruppo.voci.some((v) => selected.includes(v.value));
                        el.indeterminate =
                          alcune && !gruppo.voci.every((v) => selected.includes(v.value));
                      }
                    }}
                    onChange={() => commutaGruppo(gruppo.voci)}
                  />
                  {gruppo.nome}
                </label>
              )}
              {gruppo.voci.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted sm:py-1.5",
                    gruppo.nome && "pl-5",
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={selected.includes(option.value)}
                    onChange={() => commuta(option.value)}
                  />
                  <span className={cn("min-w-0 flex-1 truncate", option.className)}>
                    {option.label}
                  </span>
                  {option.count !== undefined && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {option.count}
                    </span>
                  )}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
