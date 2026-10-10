// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

interface PeopleInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Nomi proposti mentre si scrive (utenti, contatti, funzioni aziendali). */
  suggestions: string[];
  placeholder?: string;
  id?: string;
  className?: string;
}

/** L'ultimo nome della lista, quello che si sta ancora scrivendo. */
function currentToken(value: string): string {
  return value.slice(value.lastIndexOf(",") + 1).trimStart();
}

/** Sostituisce l'ultimo nome con quello scelto e lascia pronta la virgola. */
function replaceLastToken(value: string, choice: string): string {
  const head = value.slice(0, value.lastIndexOf(",") + 1);
  return `${head}${head ? " " : ""}${choice}, `;
}

/**
 * Campo di testo per elenchi di persone separate da virgola, con suggerimenti.
 *
 * Resta testo libero di proposito: i presenti a una riunione comprendono funzioni
 * aziendali ("AMM", "DIR") e persone esterne che non sono utenti dell'applicazione,
 * quindi un select su una tabella escluderebbe metà dei casi reali.
 */
export function PeopleInput({
  value,
  onChange,
  suggestions,
  placeholder,
  id,
  className,
}: PeopleInputProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<number | undefined>(undefined);

  const token = currentToken(value);
  const already = useMemo(
    () =>
      new Set(
        value
          .split(",")
          .map((piece) => piece.trim().toLowerCase())
          .filter(Boolean),
      ),
    [value],
  );
  const matches = useMemo(() => {
    const needle = token.trim().toLowerCase();
    return suggestions
      .filter((name) => !already.has(name.toLowerCase()))
      .filter((name) => needle === "" || name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [suggestions, token, already]);

  const choose = (name: string) => {
    onChange(replaceLastToken(value, name));
    setOpen(false);
    setHighlight(0);
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        data-no-autofocus
        onFocus={() => setOpen(true)}
        // Il click su un suggerimento arriva dopo il blur: senza il rinvio la
        // tendina sparirebbe prima di registrare la scelta.
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            const pick = matches[highlight];
            if (pick) {
              e.preventDefault();
              choose(pick);
            }
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.map((name, index) => (
            <li key={name}>
              <button
                type="button"
                className={cn(
                  "w-full rounded px-2 py-1 text-left text-sm",
                  index === highlight ? "bg-accent" : "hover:bg-accent",
                )}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={() => window.clearTimeout(blurTimer.current)}
                onClick={() => choose(name)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
