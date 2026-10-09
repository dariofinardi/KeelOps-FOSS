import type { ReactNode } from "react";

/** Classi della colonna ridotta a striscia: larghezza minima e contenuto centrato. */
export const COLLAPSED_COLUMN_CLASS = "w-14 items-center overflow-hidden";

/**
 * Contenuto di una colonna kanban vuota: maniglia di riordino, pallino colore e
 * nome scritto in verticale. Comune a tutte le kanban.
 *
 * Una colonna senza card si restringe a striscia: con sette-nove colonne, buona
 * parte delle quali spesso vuote, a piena larghezza resta poco spazio per quelle
 * che contengono qualcosa. La striscia è alta quanto la bacheca, quindi resta un
 * bersaglio comodo su cui trascinare una card, e si evidenzia come le altre.
 */
export function CollapsedColumn({
  name,
  color,
  grip,
}: {
  name: string;
  color: string;
  grip?: ReactNode;
}) {
  return (
    <>
      {grip}
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-sm font-semibold [writing-mode:vertical-rl]" style={{ color }}>
        {name}
      </span>
    </>
  );
}
