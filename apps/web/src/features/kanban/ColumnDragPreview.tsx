// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { GripVertical } from "lucide-react";

/**
 * Anteprima flottante di una colonna trascinata (dnd-kit DragOverlay): una pillola
 * compatta con pallino colore + nome, comune a tutte le kanban.
 */
export function ColumnDragPreview({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="flex w-72 items-center gap-2 rounded-lg border bg-card p-3 text-sm font-semibold shadow-lg ring-2 ring-primary"
      style={{ color }}
    >
      <GripVertical className="size-3.5 text-muted-foreground/60" />
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
    </div>
  );
}
