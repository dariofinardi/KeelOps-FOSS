import {
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, X } from "lucide-react";
import { AttachmentType, type AttachmentTarget } from "@kancrm/shared";
import { api } from "@/lib/api";
import { SidePanel } from "@/components/ui/side-panel";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useCanDownload } from "@/features/auth/useAuth";
import { useOpenAttachment } from "@/features/tasks/useTasks";

// Pesante (pdf.js e docx-preview): entra in gioco solo quando si apre un documento.
const AttachmentViewer = lazy(() =>
  import("./AttachmentViewer").then((m) => ({ default: m.AttachmentViewer })),
);

export interface OpenDocument {
  id: string;
  url: string;
  name: string;
  mimeType: string | null;
  /** Come si legge: lettore interno (file) o anteprima Google (link Workspace). */
  mode: "viewer" | "drive-preview";
}

/**
 * Apre un documento nel lettore interno, in un pannello laterale che si può
 * portare a schermo intero.
 *
 * Passa dallo stesso punto di tutti gli allegati (`/api/attachments/:id/open`):
 * è il server a dire se quel documento si legge o si scarica, secondo chi lo
 * chiede e cosa chiede (`intent=view` = leggere, non salvare).
 *
 * Lo usano sia i monitor vendite — che leggono e basta — sia chiunque lavori
 * dentro: guardare un allegato prima di deciderne qualcosa non deve costare un
 * file nella cartella dei download. Quello che il lettore non sa disegnare
 * (zip…) torna a scaricarsi come sempre.
 *
 * **Dove vive il pannello conta.** Reso da chi lo apre, muore con lui: dalla
 * sbirciatina della graffetta negli elenchi (`AttachmentsPeek`, un pannello che
 * si congeda 250 ms dopo che il cursore lo lascia) il documento si chiudeva da
 * solo appena il mouse andava a raggiungerlo — nessuno l'aveva chiuso, era il
 * suo ospite a sparire (01/09/2026). Perciò l'applicazione ne monta **uno solo**
 * in un punto stabile (`DocumentReaderProvider` in AppShell) e chi apre chiede
 * soltanto "leggi questo": il lettore resta finché lo chiudi tu. Senza provider
 * — il monitor vendite ha un guscio suo — vale il comportamento locale di prima.
 */
function useReaderState(): {
  open: (attachmentId: string, opzioni?: OpzioniApertura) => Promise<void>;
  panel: ReactNode;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const [doc, setDoc] = useState<OpenDocument | null>(null);

  const open = async (attachmentId: string, opzioni?: OpzioniApertura) => {
    try {
      const target = await api<AttachmentTarget>(
        `/api/attachments/${attachmentId}/open?intent=view`,
      );
      // Un link a un task di questa istanza: lo apre chi l'ha chiesto (sopra il
      // suo pannello), o si va alla pagina del task.
      if (target.mode === "task") {
        if (!target.taskId) return;
        if (opzioni?.onTask) opzioni.onTask(target.taskId, target.taskKind);
        else window.location.assign(`/bacheche?task=${encodeURIComponent(target.taskId)}`);
        return;
      }
      if (target.mode === "external") {
        window.open(target.url, "_blank", "noopener");
        return;
      }
      // Formato non leggibile a schermo: si scarica, come prima.
      if (target.mode === "download") {
        window.location.href = target.url;
        return;
      }
      // "viewer" e "drive-preview" condividono lo stesso pannello: cambia solo
      // chi disegna dentro (lettore interno o anteprima Google in un iframe).
      setDoc({
        id: attachmentId,
        url: target.url,
        name: target.name,
        mimeType: target.mimeType,
        mode: target.mode,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Documento non disponibile"), "error");
    }
  };

  const panel = doc && (
    // `over`: il lettore si apre sopra il pannello del task o dell'offerta.
    <SidePanel open onClose={() => setDoc(null)} label={doc.name} layer="over">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b p-3">
        <span className="min-w-0 truncate text-sm font-medium">{doc.name}</span>
        <span className="flex shrink-0 items-center gap-1">
          <DownloadButton doc={doc} />
          {/* A schermo intero: la stessa pagina del lettore, in una scheda sua. */}
          <Button
            variant="ghost"
            size="icon"
            title={t("Apri in una scheda")}
            onClick={() => window.open(`/documento/${doc.id}`, "_blank", "noopener")}
          >
            <ExternalLink className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" title={t("Chiudi")} onClick={() => setDoc(null)}>
            <X className="size-4" />
          </Button>
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={<p className="p-6 text-center text-sm text-muted-foreground">{t("Carico…")}</p>}
        >
          <AttachmentViewer url={doc.url} name={doc.name} mimeType={doc.mimeType} mode={doc.mode} />
        </Suspense>
      </div>
    </SidePanel>
  );

  return { open, panel };
}

/**
 * **Scaricare dal lettore** (25/09/2026): leggere a schermo è il primo gesto,
 * ma chi ha visto il documento spesso lo vuole anche in locale — e prima
 * doveva chiudere il lettore e tornare all'allegato. Passa da `/open` senza
 * `intent=view`, quindi è ancora il server a decidere. Solo per i file: un
 * documento Google si apre in Drive, non si scarica. Ai monitor vendite e al
 * portale clienti non si offre (vedi `useCanDownload`).
 */
function DownloadButton({ doc }: { doc: OpenDocument }) {
  const { t } = useTranslation();
  const scarica = useOpenAttachment();
  if (!useCanDownload() || doc.mode !== "viewer") return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      title={t("Scarica")}
      aria-label={t("Scarica")}
      onClick={() => void scarica({ id: doc.id, type: AttachmentType.FILE })}
    >
      <Download className="size-4" />
    </Button>
  );
}

/** Il lettore condiviso: `null` dove nessuno lo monta (si ricade sul locale). */
/** Come aprire: chi mostra l'allegato può dire cosa fare di un link a un task. */
export interface OpzioniApertura {
  onTask?: (taskId: string, taskKind?: string) => void;
}

const ReaderContext = createContext<
  ((attachmentId: string, opzioni?: OpzioniApertura) => Promise<void>) | null
>(null);

/**
 * Monta **il** lettore dell'applicazione, una volta sola e in un punto che non
 * si smonta: da lì in poi ogni `useAttachmentReader()` sotto di esso apre
 * questo, e non uno suo.
 */
export function DocumentReaderProvider({ children }: { children: ReactNode }) {
  const reader = useReaderState();
  return (
    <ReaderContext.Provider value={reader.open}>
      {children}
      {reader.panel}
    </ReaderContext.Provider>
  );
}

export function useAttachmentReader(): {
  open: (attachmentId: string, opzioni?: OpzioniApertura) => Promise<void>;
  panel: ReactNode;
} {
  const condiviso = useContext(ReaderContext);
  // L'hook si chiama comunque (le regole degli hook non ammettono rami): con il
  // provider il suo pannello non viene reso, e resta uno stato inerte.
  const locale = useReaderState();
  return condiviso ? { open: condiviso, panel: null } : locale;
}

/** Pagina a sé del lettore: è ciò che si apre con "Apri in una scheda". */
export function AttachmentReaderPage({ attachmentId }: { attachmentId: string }) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<OpenDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    void api<AttachmentTarget>(`/api/attachments/${attachmentId}/open?intent=view`)
      .then((target) => {
        if (annullato) return;
        setDoc({
          id: attachmentId,
          url: target.url,
          name: target.name,
          mimeType: target.mimeType,
          mode: target.mode === "drive-preview" ? "drive-preview" : "viewer",
        });
      })
      .catch((err: unknown) => {
        if (!annullato)
          setError(err instanceof Error ? err.message : t("Documento non disponibile"));
      });
    return () => {
      annullato = true;
    };
  }, [attachmentId, t]);

  if (error) return <p className="p-8 text-center text-sm text-destructive">{error}</p>;
  if (!doc) return <p className="p-8 text-center text-sm text-muted-foreground">{t("Carico…")}</p>;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4 text-sm font-medium">
        <span className="min-w-0 truncate">{doc.name}</span>
        <DownloadButton doc={doc} />
      </header>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={<p className="p-6 text-center text-sm text-muted-foreground">{t("Carico…")}</p>}
        >
          <AttachmentViewer url={doc.url} name={doc.name} mimeType={doc.mimeType} mode={doc.mode} />
        </Suspense>
      </div>
    </div>
  );
}
