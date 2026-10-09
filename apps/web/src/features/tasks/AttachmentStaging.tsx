import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Link2, Paperclip, Upload, X } from "lucide-react";
import { api, apiUpload } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { AttachmentIcon } from "@/features/attachments/AttachmentIcon";
import { GoogleDriveGlyph } from "@/features/attachments/GoogleDriveGlyph";
import { slot } from "@/edition/slots";
import { useNessunSelettoreDrive } from "@/features/attachments/selettore-drive";
import { edizione } from "@/edition/rotte";
import { useCaricamentiBloccati } from "@/features/auth/useAuth";

interface StagedLink {
  name: string;
  url: string;
  /** Dichiarato dal selettore Drive (icona/anteprima); assente sull'incolla-link. */
  mimeType?: string;
}

export interface AttachmentStagingOptions {
  /** Valore dell'attributo `accept` del selettore di file. */
  accept?: string;
  /** Filtro sui nomi: torna false e il file viene rifiutato con `rejectedMessage`. */
  isAllowed?: (filename: string) => boolean;
  /** Cosa dire quando un file non è ammesso. */
  rejectedMessage?: (filename: string) => string;
}

/**
 * Staging di allegati per task ancora da creare: si accumulano file e link nel
 * dialog e si caricano dopo la creazione (quando esiste l'id del task).
 * Ritorna il nodo UI, un flag `hasStaged` e `uploadTo(taskId)`.
 *
 * Con `accept` si restringono i formati (le richieste di supporto: PDF, ZIP,
 * Word, immagini): l'attributo guida il selettore e `isAllowed` ferma quel che
 * arriva per trascinamento, che l'attributo non lo guarda. Il no definitivo
 * resta del server — qui si fa solo in modo che il rifiuto arrivi subito e
 * detto in italiano, invece che dopo l'invio.
 */
export function useAttachmentStaging(options: AttachmentStagingOptions = {}) {
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<StagedLink[]>([]);

  const reset = () => {
    setFiles([]);
    setLinks([]);
  };

  /** Carica gli allegati in coda sul task appena creato (best-effort). */
  const uploadTo = async (taskId: string): Promise<{ failed: number }> => {
    const fileJobs = files.map((file) => {
      return apiUpload(`/api/tasks/${taskId}/attachments/file`, file);
    });
    const linkJobs = links.map((link) =>
      api(`/api/tasks/${taskId}/attachments/link`, { method: "POST", body: link }),
    );
    const results = await Promise.allSettled([...fileJobs, ...linkJobs]);
    return { failed: results.filter((r) => r.status === "rejected").length };
  };

  const node = (
    <AttachmentStager
      files={files}
      links={links}
      accept={options.accept}
      isAllowed={options.isAllowed}
      rejectedMessage={options.rejectedMessage}
      onAddFiles={(list) => {
        // Materializza subito: la FileList si svuota quando l'input viene resettato.
        const added = Array.from(list);
        setFiles((prev) => [...prev, ...added]);
      }}
      onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      onAddLink={(link) => setLinks((prev) => [...prev, link])}
      onRemoveLink={(i) => setLinks((prev) => prev.filter((_, idx) => idx !== i))}
    />
  );

  return { node, uploadTo, reset, hasStaged: files.length + links.length > 0 };
}

function AttachmentStager({
  files,
  links,
  accept,
  isAllowed,
  rejectedMessage,
  onAddFiles,
  onRemoveFile,
  onAddLink,
  onRemoveLink,
}: AttachmentStagingOptions & {
  files: File[];
  links: StagedLink[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveFile: (index: number) => void;
  onAddLink: (link: StagedLink) => void;
  onRemoveLink: (index: number) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  // The picker is the commercial `google` module: without it, no Drive button.
  const drive = (slot.useSelettoreDrive ?? useNessunSelettoreDrive)();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const bloccati = useCaricamentiBloccati();

  const total = files.length + links.length;

  /** Scarta subito i formati non ammessi, dicendo quale file e perché. */
  const acceptFiles = (list: FileList | File[]) => {
    const chosen = Array.from(list);
    if (!isAllowed) return onAddFiles(chosen);
    const ok = chosen.filter((file) => isAllowed(file.name));
    for (const file of chosen.filter((f) => !ok.includes(f))) {
      toast(rejectedMessage?.(file.name) ?? t("Formato non ammesso"), "error");
    }
    if (ok.length > 0) onAddFiles(ok);
  };

  const addLink = () => {
    if (linkName.trim() === "" || linkUrl.trim() === "") return;
    onAddLink({ name: linkName.trim(), url: linkUrl.trim() });
    setLinkName("");
    setLinkUrl("");
    setLinkOpen(false);
  };

  // Come nel pannello: i documenti scelti su Drive entrano in coda come link.
  const pickFromDrive = async () => {
    try {
      const docs = await drive.open();
      for (const doc of docs) onAddLink(doc);
    } catch (error) {
      // Un popup bloccato o un consenso negato devono dirsi: inghiottiti,
      // il pulsante sembra semplicemente rotto (l'annullo invece risolve []).
      toast(error instanceof Error ? error.message : t("Selettore Drive non disponibile"), "error");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Paperclip className="size-4" /> {t("Allegati")} {total > 0 && `(${total})`}
        </span>
        <span className="flex gap-1">
          {drive.enabled && (
            <Button type="button" variant="outline" size="sm" onClick={() => void pickFromDrive()}>
              <GoogleDriveGlyph className="size-3.5" /> {t("Drive")}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setLinkOpen((v) => !v)}>
            <Link2 className="size-3.5" /> {t("Link")}
          </Button>
        </span>
      </div>

      {linkOpen && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Input
            placeholder={t("Titolo (es. Contratto su Drive)")}
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
          />
          <Input
            placeholder={edizione.moduli.has("google") ? "https://drive.google.com/…" : "https://…"}
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <Button type="button" size="sm" className="self-end" onClick={addLink}>
            {t("Aggiungi link")}
          </Button>
        </div>
      )}

      {bloccati ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
          {t("Nella dimostrazione non si caricano file.")}
        </p>
      ) : (
        <label
          className={cn(
            "dropzone flex cursor-pointer items-center justify-center px-3 py-3 text-center text-xs",
            dragging && "dropzone-attiva",
          )}
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(e) => {
            if (e.dataTransfer.files.length > 0) {
              e.preventDefault();
              setDragging(false);
              acceptFiles(e.dataTransfer.files);
            }
          }}
        >
          <Upload className="mr-1.5 size-3.5" />
          {dragging ? t("Rilascia i file") : t("Trascina qui i file o clicca per sceglierli")}
          <input
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) acceptFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {total > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, i) => (
            <li
              key={`f-${i}`}
              className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{file.name}</span>
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                title={t("Rimuovi")}
                onClick={() => onRemoveFile(i)}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
          {links.map((link, i) => (
            <li
              key={`l-${i}`}
              className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <AttachmentIcon attachment={{ type: "LINK", mimeType: link.mimeType ?? null }} />
                <span className="truncate">{link.name}</span>
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                title={t("Rimuovi")}
                onClick={() => onRemoveLink(i)}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
