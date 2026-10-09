import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { UserRole } from "@kancrm/shared";
import { useCurrentUser } from "@/features/auth/useAuth";
import { DealDetailDrawer } from "@/features/deals/DealDetailDrawer";
import { TaskDetailDrawer } from "@/features/tasks/TaskDetailDrawer";
import { slot } from "@/edition/slots";
import { notificationDestination, recordTargetOf } from "./record-target";

/**
 * Apre il record giusto a partire da un riferimento (id + tipo): il pannello
 * dell'offerta per i DEAL, quello del ticket per i TICKET, quello del task per
 * tutto il resto.
 *
 * Serve ovunque si mostri un elenco che *rimanda* a qualcosa senza esserne la
 * pagina — ricerca globale, notifiche, dashboard: ognuno teneva il proprio paio
 * di stati e la propria coppia di pannelli, e chi ne aggiungeva uno se ne
 * dimenticava (le notifiche non aprivano niente). Qui la regola sta scritta una
 * volta: si chiama `open`, si mette `node` in fondo alla pagina.
 */
export function useRecordOpener(): {
  open: (taskId: string | null, taskKind?: string | null) => void;
  openTask: (taskId: string) => void;
  /** Click su una notifica: apre il record, o porta dove i task si vedono. */
  openNotification: (notification: {
    taskId: string | null;
    taskKind: string | null;
    type: string;
  }) => void;
  node: ReactNode;
} {
  const user = useCurrentUser();
  // Un cliente del portale apre sempre e solo il pannello della propria
  // richiesta: vedi `recordTargetOf`.
  const isPortal = user.role === UserRole.PORTAL;
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  return {
    open: (id, kind) => {
      const target = recordTargetOf(id, kind, isPortal);
      if (target === "deal") setDealId(id);
      else if (target === "ticket") setTicketId(id);
      else if (target === "task") setTaskId(id);
    },
    openTask: setTaskId,
    openNotification: (notification) => {
      const destination = notificationDestination(notification, isPortal);
      if (!destination) return;
      if (destination.kind === "route") navigate(destination.path);
      else if (destination.target === "deal") setDealId(destination.taskId);
      else if (destination.target === "ticket") setTicketId(destination.taskId);
      else setTaskId(destination.taskId);
    },
    node: (
      <>
        <TaskDetailDrawer taskId={taskId} onClose={() => setTaskId(null)} onOpenTask={setTaskId} />
        <DealDetailDrawer dealId={dealId} onClose={() => setDealId(null)} />
        {slot.PannelloTicket && (
          <slot.PannelloTicket
            ticketId={ticketId}
            onClose={() => setTicketId(null)}
            // Stato, assegnatario e priorità li tocca chi lavora in azienda.
            editable={user.role !== UserRole.PORTAL}
          />
        )}
      </>
    ),
  };
}
