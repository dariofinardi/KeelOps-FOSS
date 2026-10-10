// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { useFocusTrap } from "@/lib/focus-trap";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { cn } from "@/lib/utils";

/**
 * Pannello laterale: il guscio di tutti i dettagli che si aprono da destra
 * (task, offerta, ticket, cliente, documento, monitor vendite).
 *
 * **Larghezza uguale per tutti**, dichiarata qui una volta: 40% dello schermo,
 * mai sotto i 34rem perché i campi affiancati non si schiaccino, e a tutta
 * pagina sotto la soglia `sm`. Prima ognuno sceglieva la sua (`max-w-lg`,
 * `max-w-xl`, `max-w-3xl`): aprendo due pannelli di fila la pagina saltava.
 *
 * Porta con sé anche i comportamenti che un pannello deve avere e che era facile
 * dimenticare: trappola del fuoco, chiusura col clic fuori ed **Esc** (pila
 * condivisa: una conferma aperta sopra si chiude per prima).
 */
export function SidePanel({
  open,
  onClose,
  label,
  /** `over` per i pannelli che si aprono SOPRA un altro (il lettore documenti). */
  layer = "panel",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Nome del pannello per chi naviga da tastiera o con screen reader. */
  label: string;
  layer?: "panel" | "over";
  children: ReactNode;
}) {
  const trapRef = useFocusTrap(open);
  useEscapeToClose(open, onClose);
  if (!open) return null;

  return (
    <div
      className={cn("fixed inset-0", layer === "over" ? "z-50 bg-black/40" : "z-40 bg-black/30")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l bg-background shadow-xl outline-none sm:w-2/5 sm:min-w-[34rem]"
      >
        {children}
      </aside>
    </div>
  );
}
