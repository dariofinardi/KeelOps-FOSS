// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir } from "@kancrm/shared";
import { cn } from "@/lib/utils";

interface SortableHeaderProps<K extends string> {
  label: string;
  column: K;
  sortBy: K | undefined;
  sortDir: SortDir;
  onSort: (column: K) => void;
  align?: "left" | "right";
  /** Riga piccola sotto il titolo: un aggregato della colonna (es. la somma). */
  sub?: string;
}

/** Intestazione di colonna cliccabile con indicatore di ordinamento. */
export function SortableHeader<K extends string>({
  label,
  column,
  sortBy,
  sortDir,
  onSort,
  align = "left",
  sub,
}: SortableHeaderProps<K>) {
  const active = sortBy === column;
  return (
    <th className={cn("px-4 py-3 font-medium", align === "right" && "text-right")}>
      <button
        className={cn(
          "inline-flex items-center gap-1 uppercase hover:text-foreground",
          active && "text-foreground",
        )}
        onClick={() => onSort(column)}
        title={`Ordina per ${label}`}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
      {sub && (
        <span className="block text-[11px] font-normal normal-case tabular-nums text-muted-foreground">
          {sub}
        </span>
      )}
    </th>
  );
}
