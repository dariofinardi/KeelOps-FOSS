import { useTranslation } from "react-i18next";
import { MessageSquare, Paperclip } from "lucide-react";
import { HoverPanel } from "@/components/ui/hover-panel";
import { TaskAttachmentsPreview } from "./TaskAttachmentsPreview";
import { formatDateTime } from "./task-utils";
import { useTaskComments } from "./useTasks";

/**
 * Le due "sbirciatine" sugli elenchi: passando col cursore sulla graffetta o sul
 * fumetto si vede cosa c'è dentro, senza aprire il task. Il contenuto si carica
 * solo quando il pannello si apre — un elenco di cento righe non deve scaricare
 * cento conversazioni.
 */

const countClass = "inline-flex items-center gap-1 text-xs hover:text-foreground";

/** Graffetta con il numero di allegati: apre l'elenco, con link e download. */
export function AttachmentsPeek({ taskId, count }: { taskId: string; count: number }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <HoverPanel
      label={t("{{n}} tra allegati e link", { n: count })}
      trigger={
        <span className={countClass}>
          <Paperclip className="size-3.5" /> {count}
        </span>
      }
    >
      <p className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">
        {t("Allegati e link")}
      </p>
      <TaskAttachmentsPreview taskId={taskId} />
    </HoverPanel>
  );
}

/** Fumetto con il numero di messaggi: apre la conversazione, scorrevole. */
export function CommentsPeek({ taskId, count }: { taskId: string; count: number }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <HoverPanel
      label={t("{{n}} messaggi in chat", { n: count })}
      trigger={
        <span className={countClass}>
          <MessageSquare className="size-3.5" /> {count}
        </span>
      }
    >
      <ChatPreview taskId={taskId} />
    </HoverPanel>
  );
}

function ChatPreview({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  // Prima pagina (20 messaggi, dal più recente): per sbirciare basta e avanza;
  // la conversazione intera resta nel dettaglio del task.
  const { data, isLoading } = useTaskComments(taskId);
  const comments = data?.pages.flatMap((page) => page.items) ?? [];

  if (isLoading) return <p className="p-2 text-xs text-muted-foreground">{t("Carico la chat…")}</p>;
  if (comments.length === 0)
    return <p className="p-2 text-xs text-muted-foreground">{t("Nessun messaggio.")}</p>;

  return (
    <div className="flex flex-col gap-2">
      <p className="px-2 pt-0.5 text-xs font-medium text-muted-foreground">{t("Conversazione")}</p>
      {comments.map((comment) => (
        <div key={comment.id} className="rounded-md bg-muted/50 px-2 py-1.5">
          <p className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{comment.author.name}</span>
            <span className="shrink-0">{formatDateTime(comment.createdAt)}</span>
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs">{comment.body}</p>
        </div>
      ))}
      {data?.pages.at(-1)?.nextCursor && (
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">
          {t("Ci sono altri messaggi: aprili dal dettaglio del task.")}
        </p>
      )}
    </div>
  );
}
