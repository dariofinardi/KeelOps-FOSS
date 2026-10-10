// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { ToolbarButton } from "./RichTextField";
import type { MentionOptions } from "./mention";
import { useImagePaste } from "./useImagePaste";

const RichTextEditor = lazy(() => import("./editor").then((m) => ({ default: m.RichTextEditor })));

/**
 * La finestra grande per scrivere.
 *
 * Il campo nel pannello è pensato per due righe di contesto; quando una
 * descrizione diventa un documento — una tabella di consegne, tre schermate,
 * un elenco di casi da provare — serve spazio e servono strumenti. È lo stesso
 * documento, la stessa bozza e lo stesso salvataggio: si chiude e il pannello
 * ha già tutto.
 *
 * Le figure si incollano (Ctrl+V) o si trascinano dentro: è così che arriva uno
 * scatto di schermo, e chiedere di salvarlo su disco per poi ricaricarlo
 * sarebbe far fare all'utente il lavoro del programma.
 */
export function RichTextDialog({
  open,
  onClose,
  title,
  value,
  onChange,
  taskId,
  pendingImages = false,
  placeholder,
  mentions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string;
  onChange: (html: string) => void;
  /** Task a cui appartengono le figure incollate; senza, non si incolla. */
  taskId: string | null;
  /** Le figure si possono incollare anche prima di salvare (restano in attesa). */
  pendingImages?: boolean;
  placeholder?: string;
  /** Le menzioni arrivano dal campo che apre questa finestra: un elenco solo. */
  mentions?: MentionOptions;
}) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<Editor | null>(null);
  const onFiles = useImagePaste(taskId, pendingImages);
  // Il record c'è, oppure le figure possono aspettarlo: in entrambi i casi si incolla.
  const canPasteImages = Boolean(taskId) || pendingImages;

  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file && editor) void onFiles(editor, [file]);
    };
    input.click();
  };

  // Il guscio modale — sfondo, trappola del fuoco, Esc nella pila condivisa,
  // clic fuori — è quello di `Dialog`: qui dentro ci va solo ciò che scrive.
  // `fullHeight` dà l'altezza fissa con l'editor che riempie e scorre da sé.
  return (
    <Dialog open={open} onClose={onClose} title={title} size="2xl" fullHeight>
      <div className="flex flex-wrap items-center gap-0.5 rounded-md border p-1">
        <ToolbarButton
          editor={editor}
          label={t("Grassetto (Ctrl+B)")}
          active="bold"
          onClick={(c) => c.toggleBold().run()}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Corsivo (Ctrl+I)")}
          active="italic"
          onClick={(c) => c.toggleItalic().run()}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Sottolineato (Ctrl+U)")}
          active="underline"
          onClick={(c) => c.toggleUnderline().run()}
        >
          <Underline className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Barrato")}
          active="strike"
          onClick={(c) => c.toggleStrike().run()}
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>
        <Separator />
        <ToolbarButton
          editor={editor}
          label={t("Titolo")}
          active="heading"
          onClick={(c) => c.toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Sottotitolo")}
          onClick={(c) => c.toggleHeading({ level: 3 }).run()}
        >
          <Heading3 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Elenco puntato")}
          active="bulletList"
          onClick={(c) => c.toggleBulletList().run()}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Elenco numerato")}
          active="orderedList"
          onClick={(c) => c.toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Citazione")}
          active="blockquote"
          onClick={(c) => c.toggleBlockquote().run()}
        >
          <Quote className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Codice")}
          active="codeBlock"
          onClick={(c) => c.toggleCodeBlock().run()}
        >
          <Code className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Riga di separazione")}
          onClick={(c) => c.setHorizontalRule().run()}
        >
          <Minus className="size-4" />
        </ToolbarButton>
        <Separator />
        <ToolbarButton
          editor={editor}
          label={t("Tabella 3×3")}
          onClick={(c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <Table className="size-4" />
        </ToolbarButton>
        {/* I comandi sulle righe e colonne hanno senso solo dentro una tabella:
              altrove non si mostrano nemmeno, invece di stare lì spenti. */}
        {editor?.isActive("table") && (
          <>
            <ToolbarButton
              editor={editor}
              label={t("Aggiungi colonna")}
              onClick={(c) => c.addColumnAfter().run()}
            >
              <span className="px-1 text-xs font-medium">{t("+col")}</span>
            </ToolbarButton>
            <ToolbarButton
              editor={editor}
              label={t("Aggiungi riga")}
              onClick={(c) => c.addRowAfter().run()}
            >
              <span className="px-1 text-xs font-medium">{t("+riga")}</span>
            </ToolbarButton>
            <ToolbarButton
              editor={editor}
              label={t("Elimina colonna")}
              onClick={(c) => c.deleteColumn().run()}
            >
              <span className="px-1 text-xs font-medium">{t("−col")}</span>
            </ToolbarButton>
            <ToolbarButton
              editor={editor}
              label={t("Elimina riga")}
              onClick={(c) => c.deleteRow().run()}
            >
              <span className="px-1 text-xs font-medium">{t("−riga")}</span>
            </ToolbarButton>
            <ToolbarButton
              editor={editor}
              label={t("Elimina tabella")}
              onClick={(c) => c.deleteTable().run()}
            >
              <Trash2 className="size-4" />
            </ToolbarButton>
          </>
        )}
        <Separator />
        <ToolbarButton
          editor={editor}
          label={t("Inserisci immagine")}
          disabled={!canPasteImages}
          onClick={pickImage}
        >
          <ImagePlus className="size-4" />
        </ToolbarButton>
        <Separator />
        <ToolbarButton
          editor={editor}
          label={t("Annulla (Ctrl+Z)")}
          onClick={(c) => c.undo().run()}
        >
          <Undo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton editor={editor} label={t("Ripeti (Ctrl+Y)")} onClick={(c) => c.redo().run()}>
          <Redo2 className="size-4" />
        </ToolbarButton>
        <span className="ml-auto pr-1 text-xs text-muted-foreground">
          {canPasteImages
            ? t("Le immagini si incollano o si trascinano dentro.")
            : t("Le immagini si incollano dopo il primo salvataggio.")}
        </span>
      </div>

      <Suspense
        fallback={<div className="flex-1 rounded-md border p-3 text-sm">{t("Apertura…")}</div>}
      >
        <RichTextEditor
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          onReady={setEditor}
          onFiles={onFiles}
          mentions={mentions}
          autoFocus
          rich
          fill
        />
      </Suspense>
    </Dialog>
  );
}

function Separator() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}
