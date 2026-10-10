// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ColumnOrderMap } from "@kancrm/shared";
import { api } from "@/lib/api";

/**
 * Ordine delle colonne kanban salvato per-utente (per bacheca). Comune a tutte
 * le kanban: ognuna passa la propria `key` (es. "task:ADMIN", "deal", "board:id").
 */
export function useColumnOrder() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["column-order"],
    queryFn: async () =>
      (await api<{ orders: ColumnOrderMap }>("/api/profile/column-order")).orders,
  });

  const mutation = useMutation({
    mutationFn: (vars: { key: string; order: string[] }) =>
      api<{ orders: ColumnOrderMap }>("/api/profile/column-order", { method: "PUT", body: vars }),
    // Ottimistico: la kanban si riordina subito.
    onMutate: ({ key, order }) => {
      qc.setQueryData<ColumnOrderMap>(["column-order"], (prev) => {
        const next = { ...(prev ?? {}) };
        if (order.length > 0) next[key] = order;
        else delete next[key];
        return next;
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["column-order"] }),
  });

  return {
    orders: data ?? {},
    setOrder: (key: string, order: string[]) => mutation.mutate({ key, order }),
  };
}

/** Riordina `columns` secondo `savedIds`; le colonne non elencate restano in coda. */
export function applyColumnOrder<T extends { id: string }>(columns: T[], savedIds?: string[]): T[] {
  if (!savedIds || savedIds.length === 0) return columns;
  const index = new Map(savedIds.map((id, i) => [id, i]));
  return [...columns].sort((a, b) => (index.get(a.id) ?? Infinity) - (index.get(b.id) ?? Infinity));
}

/** Nuovo ordine dopo aver trascinato la colonna `activeId` sopra `overId`. */
export function reorderColumns(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  return arrayMove(ids, from, to);
}

/**
 * Wiring comune del riordino colonne con dnd-kit (SortableContext orizzontale),
 * condiviso da tutte le kanban. Solo la maniglia (`handleProps`) avvia il drag —
 * il resto della colonna resta cliccabile; `style` porta la transizione fluida
 * mentre le altre colonne scorrono. La stessa colonna è anche bersaglio di rilascio
 * per le card (il droppable di useSortable ha lo stesso id). `data.type = "column"`
 * distingue in onDragEnd il riordino colonne dal drag delle card.
 */
export function useSortableColumn(id: string, disabled = false) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id, data: { type: "column" }, disabled });
  return {
    setNodeRef,
    isDragging,
    isOver,
    style: { transform: CSS.Translate.toString(transform), transition } as CSSProperties,
    handleProps: { ref: setActivatorNodeRef, ...attributes, ...listeners },
  };
}
