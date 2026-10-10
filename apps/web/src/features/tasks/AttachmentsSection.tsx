// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  ExternalLink,
  Eye,
  Link2,
  MessageSquare,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import type { TaskDetail } from "@kancrm/shared";
import {
  TICKET_ATTACHMENT_EXTENSIONS,
  TICKET_ATTACHMENT_LABEL,
  extraDelleAmmesse as inPiu,
  matchesExtensions,
  UserRole,
  drivePreviewUrl,
  viewableKind,
  TaskKind,
} from "@kancrm/shared";
import { useCurrentUser } from "@/features/auth/useAuth";
import { usePlugins } from "@/features/plugins/usePlugins";
import { useAttachmentReader } from "@/features/attachments/useAttachmentReader";
import { isTaskLink, useOpenLinkedTask } from "./linked-task-context";
import { AttachmentIcon } from "@/features/attachments/AttachmentIcon";
import { vaiAlMessaggio } from "./message-focus";
import { slot } from "@/edition/slots";
import { useNessunSelettoreDrive } from "@/features/attachments/selettore-drive";
import { edizione } from "@/edition/rotte";
import { GoogleDriveGlyph } from "@/features/attachments/GoogleDriveGlyph";
import { WordGlyph } from "@/features/attachments/WordGlyph";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/bytes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  useAddLinkAttachment,
  useDeleteAttachment,
  useOpenAttachment,
  useUploadAttachment,
} from "./useTasks";

export function AttachmentsSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const utente = useCurrentUser();
  const isPortal = utente.role === UserRole.PORTAL;
  /** Elenco chiuso per il cliente del portale; vuoto (nessun limite) all'interno. */
  /**
   * L'elenco arriva dall'utente. Se manca — una risposta `/me` vecchia in
   * cache, un server a metà rilascio — si torna a quello compilato: un
   * elenco vuoto rifiuterebbe **qualunque** file, e un cliente resterebbe
   * fuori senza capire perché.
   */
  const ammesse = utente.attachmentExtensions?.length
    ? utente.attachmentExtensions
    : [...TICKET_ATTACHMENT_EXTENSIONS];
  const addLink = useAddLinkAttachment();
  const upload = useUploadAttachment();
  const removeAttachment = useDeleteAttachment();
  const openAttachment = useOpenAttachment();
  const apriTask = useOpenLinkedTask();
  // Guardare un allegato non deve costare un file scaricato: PDF, Word e
  // immagini si leggono qui dentro, il download resta un gesto a parte.
  const reader = useAttachmentReader();
  // The picker is the commercial `google` module: without it, no Drive button.
  const drive = (slot.useSelettoreDrive ?? useNessunSelettoreDrive)();
  /**
   * **«Word»: il documento dell'offerta scritto da un plugin.** (Deriva
   * dall'analisi fatta per MikeRust.) Compare
   * in coda a Drive, Link e File solo su un'offerta, solo per chi la può
   * modificare, e solo se un plugin montato dichiara l'ancora `deal`
   * (QuoteDOCX). Senza plugin la riga è quella di sempre: il core non sa
   * cosa il plugin faccia, sa solo che è figlio dell'offerta e lo apre con
   * `?offerta=<id>`, come il bottone di progetto apre TasksMap.
   */
  const plugins = usePlugins().data ?? [];
  const editoriOfferta = plugins.filter((plugin) => plugin.anchors?.deal);
  const mostraWord = task.kind === TaskKind.DEAL && task.canEdit && editoriOfferta.length > 0;
  /**
   * **Aprire un .docx allegato, non solo sbirciarlo.** L'occhio ne mostra
   * l'anteprima; chi può modificare il task lo apre per davvero nel plugin
   * che dichiara l'ancora `docx`, che lo importa e lo riscrive al posto suo
   * quando si salva (richiesta del 21/09/2026). Senza plugin resta l'anteprima.
   */
  const editoriDocx = plugins.filter((plugin) => plugin.anchors?.docx);
  const apribileInWord = (a: { type: string; name: string }) =>
    task.canEdit && editoriDocx.length > 0 && a.type === "FILE" && /\.docx$/i.test(a.name);
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const submitLink = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    addLink.mutate(
      { taskId: task.id, name: linkName, url: linkUrl },
      {
        onSuccess: () => {
          setLinkName("");
          setLinkUrl("");
          // Non chiudere: così si aggiungono più link di seguito.
          toast(t("Link aggiunto"), "success");
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  // Selettore Google Drive: i documenti scelti diventano allegati LINK dalla
  // stessa rotta dell'incolla-link, col mimeType per l'icona e l'anteprima.
  const pickFromDrive = async () => {
    setError(null);
    try {
      const docs = await drive.open();
      for (const doc of docs) {
        await addLink.mutateAsync({ taskId: task.id, ...doc });
      }
      if (docs.length > 0) {
        toast(
          docs.length === 1 ? t("Link aggiunto") : t("{{n}} link aggiunti", { n: docs.length }),
          "success",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Selettore Drive non disponibile"));
    }
  };

  // Carica in parallelo tutti i file scelti/trascinati, con riepilogo finale.
  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);

    /**
     * **Il rifiuto dice quale file.**
     *
     * Il cliente del portale può allegare solo certi formati, e il no
     * definitivo lo dà il server — ma il suo messaggio parla dei formati, non
     * del file: trascinandone sei, restava da indovinare quale fosse quello
     * sbagliato. Nel dialogo di apertura della richiesta il file lo si nomina
     * già (`useAttachmentStaging`); qui, dove la richiesta si lavora, no —
     * ed è lo stesso gesto (20/08/2026). `firstRejectedAttachment` esiste
     * apposta.
     */
    if (isPortal) {
      // L'elenco valido arriva dall'utente (`attachmentExtensions`): quello di
      // casa più le estensioni configurate nella pagina Sistema. Ricalcolarlo
      // qui sarebbe una seconda verità, e divergerebbe alla prima estensione configurata.
      const rifiutato = list
        .map((file) => file.name)
        .find((nome) => !matchesExtensions(nome, ammesse));
      if (rifiutato) {
        setError(
          t("{{file}} non si può allegare: sono ammessi {{formats}}.", {
            file: rifiutato,
            formats: t(TICKET_ATTACHMENT_LABEL) + inPiu(ammesse),
          }),
        );
        return;
      }
    }

    const results = await Promise.allSettled(
      list.map((file) => upload.mutateAsync({ taskId: task.id, file })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      toast(
        list.length === 1 ? t("File caricato") : t("{{n}} file caricati", { n: list.length }),
        "success",
      );
    } else {
      toast(
        t("{{ok}} caricati, {{failed}} non riusciti", { ok: list.length - failed, failed }),
        "error",
      );
    }
  };

  return (
    <section
      className="mt-6"
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
          void uploadFiles(e.dataTransfer.files);
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="size-4" /> {t("Allegati")} ({task.attachments.length})
        </h3>
        <div className="flex gap-1">
          {drive.enabled && (
            <Button variant="outline" size="sm" onClick={() => void pickFromDrive()}>
              <GoogleDriveGlyph className="size-3.5" /> {t("Drive")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setLinkOpen((v) => !v)}>
            <Link2 className="size-3.5" /> {t("Link")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={upload.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" /> {upload.isPending ? t("Carico…") : t("File")}
          </Button>
          {mostraWord &&
            editoriOfferta.map((plugin) => (
              <Button
                key={plugin.nome}
                variant="outline"
                size="sm"
                title={editoriOfferta.length > 1 ? t(plugin.voce) : t("Word")}
                // un indirizzo dell'app, non useNavigate: la sezione vive anche
                // in alberi senza Router (i dom-test), come fa PluginMenu
                onClick={() =>
                  window.location.assign(`/estensioni/${plugin.nome}?offerta=${task.id}`)
                }
              >
                <WordGlyph className="size-3.5" /> {t("Word")}
              </Button>
            ))}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            // Al cliente il selettore propone i formati che il server accetta:
            // offrirgli tutto e poi rifiutare è un giro a vuoto (la regola
            // resta del server, questo è il suggerimento).
            accept={isPortal ? ammesse.join(",") : undefined}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {linkOpen && (
        <form onSubmit={submitLink} className="mb-3 flex flex-col gap-2 rounded-md border p-3">
          <Input
            placeholder={t("Titolo (es. Contratto su Drive)")}
            required
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
          />
          <Input
            placeholder={edizione.moduli.has("google") ? "https://drive.google.com/…" : "https://…"}
            type="url"
            required
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setLinkOpen(false)}>
              {t("Chiudi")}
            </Button>
            <Button type="submit" size="sm" disabled={addLink.isPending}>
              {t("Aggiungi link")}
            </Button>
          </div>
        </form>
      )}
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

      {/* Zona di rilascio: trascina qui uno o più file. */}
      <div
        className={cn("dropzone mb-2 px-3 py-2 text-center text-xs", dragging && "dropzone-attiva")}
      >
        {dragging
          ? t("Rilascia i file per allegarli")
          : t("Trascina qui i file, o usa il pulsante File")}
      </div>

      <ul className="flex flex-col gap-1">
        {task.attachments.map((attachment) => (
          <li
            key={attachment.id}
            className={cn(
              "flex items-center justify-between rounded-md border px-3 py-2 text-sm",
              // Arrivato con un messaggio: si vede prima di leggere il nome,
              // perché cambia cosa se ne può fare (non si toglie da qui).
              attachment.commentId && "border-dashed bg-muted/30",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 items-center gap-2 text-left hover:underline"
              title={
                attachment.type === "LINK"
                  ? isTaskLink(attachment.url)
                    ? t("Apri il task")
                    : attachment.url && drivePreviewUrl(attachment.url)
                      ? t("Leggi il documento")
                      : t("Apri il link")
                  : viewableKind(attachment.mimeType, attachment.name)
                    ? t("Leggi il documento")
                    : t("Scarica")
              }
              onClick={() => void reader.open(attachment.id, { onTask: apriTask })}
            >
              <AttachmentIcon attachment={attachment} />
              <span className="truncate">{attachment.name}</span>
              {attachment.size !== null && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(attachment.size)}
                </span>
              )}
            </button>
            <div className="flex shrink-0 gap-1">
              {/* Leggere e salvare sono due gesti diversi, e si vedono
                  entrambi: l'occhio apre il documento a schermo, la freccia lo
                  porta via (o all'editor Google, per i link). Il clic sul nome
                  fa la lettura. L'occhio compare anche sui link Google
                  Workspace: si leggono nello stesso pannello di PDF e Word. */}
              {(attachment.type === "FILE"
                ? Boolean(viewableKind(attachment.mimeType, attachment.name))
                : // The Drive preview is the commercial `google` module.
                  edizione.moduli.has("google") &&
                  Boolean(attachment.url && drivePreviewUrl(attachment.url))) && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("Leggi il documento")}
                  onClick={() => void reader.open(attachment.id, { onTask: apriTask })}
                >
                  <Eye className="size-4" />
                </Button>
              )}
              {apribileInWord(attachment) && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("Apri in Word")}
                  onClick={() => {
                    const plugin = editoriDocx[0];
                    if (plugin) {
                      window.location.assign(
                        `/estensioni/${plugin.nome}?allegato=${attachment.id}&task=${task.id}`,
                      );
                    }
                  }}
                >
                  <WordGlyph className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                title={
                  attachment.type !== "LINK"
                    ? t("Scarica")
                    : isTaskLink(attachment.url)
                      ? t("Apri il task")
                      : t("Apri link")
                }
                onClick={() => void openAttachment(attachment)}
              >
                {attachment.type === "LINK" ? (
                  <ExternalLink className="size-4" />
                ) : (
                  <Download className="size-4" />
                )}
              </Button>
              {attachment.commentId ? (
                /**
                 * **Arrivato con un messaggio: si va a leggerlo, non si
                 * cancella.** Il cestino qui toglierebbe il documento a chi
                 * l'ha mandato, e lascerebbe in chat una frase che parla di
                 * qualcosa che non c'è più: il file se ne va con il suo
                 * messaggio, e quello lo cancella solo chi l'ha scritto (o un
                 * amministratore). Al suo posto la strada per arrivarci.
                 */
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("Vai al messaggio con cui è arrivato")}
                  aria-label={t("Vai al messaggio con cui è arrivato")}
                  onClick={() => vaiAlMessaggio(attachment.commentId!)}
                >
                  <MessageSquare className="size-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("Rimuovi")}
                  onClick={() =>
                    removeAttachment.mutate({ taskId: task.id, attachmentId: attachment.id })
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {reader.panel}
    </section>
  );
}
