import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { TICKET_PRIORITY_LABELS, type TicketPriority } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { priorityBadgeClass } from "@/features/tasks/ticket-accent";

/**
 * L'etichetta della priorità, nello **stesso colore del bordo nel kanban**
 * (rosso alta, arancione media, blu notte bassa): chi riceve la richiesta legge
 * a parole quello che sulla bacheca vede a colpo d'occhio. Il codice colore sta
 * in un posto solo, `features/tasks/ticket-accent.ts`.
 */
/**
 * La pastiglia della priorità: **una bandierina e la parola**.
 *
 * Il colore da solo non basta — dice "questo è importante" a chi conosce il
 * codice (rosso alta, arancione media, blu notte bassa) e niente a chi lo vede
 * la prima volta, e a un daltonico nemmeno la prima cosa. La bandierina dice
 * *di che cosa* stiamo parlando anche in mezzo alle altre pastiglie della riga,
 * che portano il pallino dello stato. Su una riga sola, come tutte le pastiglie.
 */
export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        priorityBadgeClass(priority),
      )}
    >
      <Flag className="size-3 shrink-0" aria-hidden="true" />
      {t(TICKET_PRIORITY_LABELS[priority])}
    </span>
  );
}
