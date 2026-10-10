// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type ReactNode } from "react";
import { TaskKind } from "@kancrm/shared";
import { slot } from "@/edition/slots";
import { LinkedTaskContext } from "./linked-task-context";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

/**
 * Lo strato dei task aperti da un link (06/10/2026): avvolge un pannello — oggi
 * quello dell'offerta — e apre il task **sopra**, nello strato `over`. Il
 * pannello di partenza resta montato sotto, con quello che si stava guardando;
 * chiudere il task (X, Esc, clic fuori) toglie solo lo strato di sopra.
 *
 * Un livello solo: un altro link seguito dal task prende il suo posto, e
 * chiudendo si torna sempre al record di partenza, non a una catena di pannelli.
 */
export function LinkedTaskLayer({ children }: { children: ReactNode }) {
  const [aperto, setAperto] = useState<{ id: string; kind?: string } | null>(null);
  const chiudi = () => setAperto(null);
  return (
    <LinkedTaskContext.Provider value={(id, kind) => setAperto({ id, kind })}>
      {children}
      {aperto?.kind === TaskKind.TICKET && slot.PannelloTicket ? (
        <slot.PannelloTicket
          ticketId={aperto.id}
          onClose={chiudi}
          // Le offerte le apre solo chi lavora in azienda (mai il portale).
          editable
          layer="over"
        />
      ) : (
        <TaskDetailDrawer
          taskId={aperto?.id ?? null}
          onClose={chiudi}
          onOpenTask={(id) => setAperto({ id })}
          layer="over"
        />
      )}
    </LinkedTaskContext.Provider>
  );
}
