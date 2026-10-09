import { Download, ExternalLink, Eye, FileText, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { viewableKind } from "@kancrm/shared";
import { useAttachmentReader } from "@/features/attachments/useAttachmentReader";
import { useOpenAttachment, useTaskDetail } from "./useTasks";

/**
 * Allegati e link di un task, in sola lettura: è l'anteprima che si apre
 * espandendo una riga dell'elenco, per arrivare al documento senza aprire il
 * dettaglio. Si aggiungono e si eliminano dal dettaglio (vedi AttachmentsSection).
 *
 * Il dettaglio viene chiesto solo quando la riga è aperta, e resta in cache: se
 * poi si apre il task il pannello è già pronto.
 */
export function TaskAttachmentsPreview({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { data: task, isLoading } = useTaskDetail(taskId);
  // Stesso gesto del pannello: il documento si legge a schermo, e solo quello
  // che il lettore non sa disegnare si scarica.
  const reader = useAttachmentReader();
  const openAttachment = useOpenAttachment();

  if (isLoading) return <p className="px-3 py-1.5 text-xs text-muted-foreground">{t("Carico…")}</p>;
  const attachments = task?.attachments ?? [];
  if (attachments.length === 0) return null;

  return (
    <>
      <ul className="flex w-full flex-col gap-1">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex w-full min-w-0 items-center gap-1">
            <button
              type="button"
              // `min-w-0 flex-1` e non `w-full`: il nome deve restringersi per
              // lasciare posto alle icone, non spingerle fuori dal pannello.
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/60"
              title={
                attachment.type === "LINK"
                  ? t("Apri il link")
                  : viewableKind(attachment.mimeType, attachment.name)
                    ? t("Leggi il documento")
                    : t("Scarica")
              }
              onClick={(e) => {
                e.stopPropagation();
                void reader.open(attachment.id);
              }}
            >
              {attachment.type === "LINK" ? (
                <Link2 className="size-3.5 shrink-0" />
              ) : (
                <FileText className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
            </button>
            {/* Le due strade restano distinte anche qui: leggere a schermo o
                salvare il file. Il nome apre la lettura. */}
            {attachment.type === "FILE" && viewableKind(attachment.mimeType, attachment.name) && (
              <button
                type="button"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted/60"
                title={t("Leggi il documento")}
                aria-label={t("Leggi {{name}}", { name: attachment.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  void reader.open(attachment.id);
                }}
              >
                <Eye className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted/60"
              title={attachment.type === "LINK" ? t("Apri il link") : t("Scarica")}
              aria-label={
                attachment.type === "LINK"
                  ? t("Apri {{name}}", { name: attachment.name })
                  : t("Scarica {{name}}", { name: attachment.name })
              }
              onClick={(e) => {
                e.stopPropagation();
                void openAttachment(attachment);
              }}
            >
              {attachment.type === "LINK" ? (
                <ExternalLink className="size-3.5" />
              ) : (
                <Download className="size-3.5" />
              )}
            </button>
          </li>
        ))}
      </ul>
      {reader.panel}
    </>
  );
}
