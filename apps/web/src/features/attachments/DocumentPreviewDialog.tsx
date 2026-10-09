import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { AttachmentType, type AttachmentTarget } from "@kancrm/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useOpenAttachment } from "@/features/tasks/useTasks";

// Pesante (pdf.js): entra in gioco solo quando si apre un documento.
const AttachmentViewer = lazy(() =>
  import("./AttachmentViewer").then((m) => ({ default: m.AttachmentViewer })),
);

/**
 * **Un documento a schermo, al centro** (18/09/2026): la lettura di una nota
 * di rilascio nel portale. Il lettore dell'applicazione è un pannello di lato,
 * pensato per guardare un allegato senza lasciare il task; qui il documento
 * *è* ciò che si è venuti a leggere, e sta nel mezzo, grande. Il server resta
 * il punto unico che decide (`/open?intent=view`), il disegno è lo stesso
 * lettore, e scaricare è un gesto a parte, sempre a portata.
 */
export function DocumentPreviewDialog({
  attachmentId,
  name,
  onClose,
}: {
  attachmentId: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const scarica = useOpenAttachment();
  const [target, setTarget] = useState<AttachmentTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    void api<AttachmentTarget>(`/api/attachments/${attachmentId}/open?intent=view`)
      .then((risposta) => {
        if (!annullato) setTarget(risposta);
      })
      .catch((err: unknown) => {
        if (!annullato)
          setError(err instanceof Error ? err.message : t("Documento non disponibile"));
      });
    return () => {
      annullato = true;
    };
  }, [attachmentId, t]);

  return (
    <Dialog open onClose={onClose} title={name} size="2xl" fullHeight>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void scarica({ id: attachmentId, type: AttachmentType.FILE })}
        >
          <Download className="size-4" /> {t("Scarica")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        {error ? (
          <p className="p-6 text-center text-sm text-destructive">{error}</p>
        ) : target && (target.mode === "viewer" || target.mode === "drive-preview") ? (
          <Suspense
            fallback={
              <p className="p-6 text-center text-sm text-muted-foreground">{t("Carico…")}</p>
            }
          >
            <AttachmentViewer
              url={target.url}
              name={target.name}
              mimeType={target.mimeType}
              mode={target.mode}
            />
          </Suspense>
        ) : target ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("Questo documento non si può leggere qui: scaricalo.")}
          </p>
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("Carico…")}</p>
        )}
      </div>
    </Dialog>
  );
}
