// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

export interface ComboboxItem {
  id: string;
  /** Testo mostrato e su cui si cerca. */
  label: string;
}

interface ComboboxProps {
  /** Va sul campo di ricerca, così una `<Label htmlFor>` resta collegata. */
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  items: ComboboxItem[];
  placeholder?: string;
  /** Etichetta della voce "nessuna scelta"; assente = scelta obbligatoria. */
  emptyLabel?: string;
  icon?: ReactNode;
  className?: string;
  /**
   * Quante voci disegnare al primo colpo. Non è più un tetto: scorrendo se ne
   * aggiungono altre (vedi `PASSO`), così un elenco lungo si può anche
   * sfogliare invece di doverlo per forza cercare.
   */
  limit?: number;
  /**
   * Ordina le voci per nome. È il valore giusto quasi sempre — un elenco di
   * aziende o persone si scorre solo se è in ordine — ma chi ha un ordine
   * **suo** che porta informazione (i membri del progetto prima degli altri)
   * lo spegne.
   */
  ordina?: boolean;
}

/** Quante voci in più a ogni "fondo raggiunto". */
const PASSO = 30;

/**
 * Combo con filtro per gli elenchi che crescono nel tempo (progetti, offerte,
 * contatti, task): si digita per cercare invece di scorrere centinaia di voci.
 *
 * Per gli elenchi chiusi e brevi — stati, fasi, tipi di attività, priorità — resta
 * giusta una `<select>` normale: aprire e vedere tutte le opzioni è più veloce.
 *
 * La voce selezionata resta sempre visibile anche se non è tra le prime `limit`,
 * e viene mostrata come riga compatta finché non si torna a cercare.
 */
export function Combobox({
  id,
  value,
  onChange,
  items,
  placeholder,
  emptyLabel,
  icon,
  className,
  limit = 30,
  ordina = true,
}: ComboboxProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  /** Quante ne sto mostrando adesso: cresce scorrendo, riparte cercando. */
  const [mostrate, setMostrate] = useState(limit);

  const selected = value ? (items.find((item) => item.id === value) ?? null) : null;
  const needle = q.trim().toLowerCase();
  const ordinati = useMemo(
    () =>
      ordina
        ? [...items].sort((a, b) =>
            a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
          )
        : items,
    [items, ordina],
  );
  const trovati = useMemo(
    () =>
      needle ? ordinati.filter((item) => item.label.toLowerCase().includes(needle)) : ordinati,
    [ordinati, needle],
  );
  const matches = trovati.slice(0, mostrate);
  const restanti = trovati.length - matches.length;

  // Una ricerca nuova riparte dall'inizio: le voci caricate scorrendo prima
  // valevano per un altro elenco.
  useEffect(() => setMostrate(limit), [needle, limit]);

  /**
   * La tendina vive fuori dal suo contenitore, in un portale agganciato al
   * campo: il perché e il come stanno in `lib/useAnchoredPanel`.
   */
  const { ancora, posizione } = useAnchoredPanel<HTMLDivElement>(open);

  /** Vicini al fondo: si aggiunge un blocco, senza aspettare che si cerchi. */
  const lista = useRef<HTMLUListElement>(null);
  const scorrendo = () => {
    const el = lista.current;
    if (!el || restanti <= 0) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      setMostrate((quante) => quante + PASSO);
    }
  };

  const select = (id: string | null) => {
    onChange(id);
    setQ("");
    setOpen(false);
  };

  if (selected && !open) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm",
          className,
        )}
      >
        {icon}
        <button
          type="button"
          id={id}
          className="min-w-0 flex-1 truncate text-left"
          title={t("Cambia")}
          onClick={() => setOpen(true)}
        >
          {selected.label}
        </button>
        {emptyLabel !== undefined && (
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={emptyLabel}
            title={emptyLabel}
            onClick={() => select(null)}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={ancora} className={cn("relative", className)}>
      {/*
        Il segno c'è anche **da vuoto**, che è lo stato in cui la combo si guarda
        più spesso: prima compariva solo a scelta fatta, quindi il filtro cliente
        era l'unico della barra senza icona proprio quando diceva "tutti"
        (17/08/2026).
      */}
      {icon && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
      )}
      <Input
        id={id}
        autoFocus={open}
        // il fuoco iniziale di un pannello non deve cadere qui: aprirebbe la
        // tendina addosso al contenuto (vedi lib/focus-trap)
        data-no-autofocus
        /*
         * **Niente suggerimenti del browser.** Questo campo non è un modulo da
         * compilare: è la ricerca dentro a un elenco che sta già comparendo
         * sotto. Senza queste righe il browser ci apre sopra la sua lista di
         * valori digitati in passato, che copre le voci vere — e chi sceglie
         * un progetto si trova a leggere «flui, padm, tec» invece dei nomi
         * (09/09/2026).
         *
         * `autocomplete="off"` è lo standard; le altre due sono per i gestori
         * di password, che quello standard lo ignorano e mettono la loro icona
         * dentro al campo.
         */
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        spellCheck={false}
        className={icon ? "pl-8" : undefined}
        placeholder={placeholder ?? t("Cerca…")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Il blur precede il click sulla voce: si chiude con un attimo di ritardo.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open &&
        posizione !== null &&
        createPortal(
          <ul
            ref={lista}
            onScroll={scorrendo}
            // fissa e sopra ogni strato (dialog e pannelli stanno a z-50)
            className="fixed z-[60] overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
            style={{
              left: posizione.left,
              top: posizione.top,
              width: posizione.width,
              maxHeight: posizione.maxHeight,
            }}
          >
            {emptyLabel !== undefined && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(null)}
                >
                  <span className="size-4 shrink-0" />
                  {emptyLabel}
                </button>
              </li>
            )}
            {matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                    item.id === value && "bg-accent",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(item.id)}
                >
                  {item.id === value ? (
                    <Check className="size-4 shrink-0" />
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">
                {t("Nessun risultato.")}
              </li>
            )}
            {restanti > 0 && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                {t("Altre {{count}}: scorri o scrivi per cercarle.", { count: restanti })}
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
