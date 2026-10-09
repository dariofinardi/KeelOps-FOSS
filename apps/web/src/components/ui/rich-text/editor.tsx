import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { plainToRichText } from "@kancrm/shared";
import { MentionSuggestion, type MentionOptions } from "./mention";

/**
 * L'editor vero e proprio: pesante (ProseMirror), quindi ci si arriva sempre
 * da `RichTextField`, che lo carica solo quando serve davvero.
 *
 * Qui non si decide **quando** si salva — quello lo sa `useAutosaveText`, come
 * per ogni altro campo dell'applicazione. Qui si scrive e si comunica cosa c'è
 * scritto.
 *
 * Le scorciatoie (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Z) le porta ProseMirror: sono
 * quelle che chiunque si aspetta e non vanno reinventate.
 */
export interface RichTextEditorProps {
  /** Valore corrente: HTML dell'editor, o testo semplice di una vecchia descrizione. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** L'editor riempie lo spazio che ha (finestra grande) invece di crescere col testo. */
  fill?: boolean;
  className?: string;
  /** Riceve l'editor appena pronto: serve alle barre degli strumenti. */
  onReady?: (editor: Editor | null) => void;
  autoFocus?: boolean;
  /** Tabelle e figure: servono nella finestra grande, non nel campo del pannello. */
  rich?: boolean;
  /**
   * Cosa fare dei file incollati o trascinati dentro. Restituisce `true` se se
   * n'è occupata lei — l'editor allora non prova a incollarli da sé.
   */
  onFiles?: (editor: Editor, files: File[]) => boolean | Promise<boolean>;
  /** Menzioni con `@`: chi si può nominare e come si disegna l'elenco. */
  mentions?: MentionOptions;
}

/** Estensioni comuni a tutte le finestre in cui si scrive: una lista sola. */
export function baseExtensions(placeholder?: string, rich = false, mentions?: MentionOptions) {
  return [
    StarterKit.configure({
      // I titoli grandi in una descrizione non servono: si sta scrivendo dentro
      // un campo, non una pagina.
      heading: { levels: [2, 3] },
      link: { openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer nofollow" } },
    }),
    Placeholder.configure({ placeholder: placeholder ?? "" }),
    // Tabelle e figure si scrivono nella finestra grande, dove c'è spazio per
    // vederle; nel campo del pannello si leggono lo stesso, perché il documento
    // è lo stesso — sono i comandi a non esserci.
    ...(rich
      ? [
          Image.configure({ HTMLAttributes: { class: "max-w-full" } }),
          TableKit.configure({ table: { resizable: true } }),
        ]
      : []),
    // La chiocciola apre l'elenco delle persone e scrive testo normale: le
    // menzioni il server le riconosce leggendo, non da un marcatore.
    ...(mentions ? [MentionSuggestion.configure(mentions)] : []),
  ];
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  fill = false,
  className,
  onReady,
  autoFocus = false,
  rich = false,
  onFiles,
  mentions,
}: RichTextEditorProps) {
  // L'editor si riferisce a sé stesso dentro i propri gestori: quando quelli
  // vengono creati la costante non esiste ancora.
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions: baseExtensions(placeholder, rich, mentions),
    // Il testo semplice delle descrizioni di prima entra come paragrafi, non
    // come una riga sola.
    content: plainToRichText(value),
    autofocus: autoFocus,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      // Incollare uno scatto di schermo: il browser dà i byte, non un indirizzo.
      handlePaste: (_view, event) => handleFiles(Array.from(event.clipboardData?.files ?? [])),
      handleDrop: (_view, event) => {
        const dropped = (event as DragEvent).dataTransfer?.files;
        return handleFiles(Array.from(dropped ?? []));
      },
      attributes: {
        class: [
          "rich-text w-full rounded-md border bg-background p-3 text-sm outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          fill ? "h-full overflow-auto" : "min-h-24",
          className ?? "",
        ].join(" "),
      },
    },
  });

  editorRef.current = editor;
  useEffect(() => onReady?.(editor), [editor, onReady]);

  // L'editor vuole sapere subito se il file se lo prende qualcun altro, ma il
  // caricamento è una faccenda lunga: si risponde "sì, ci penso io" e si va.
  function handleFiles(files: File[]): boolean {
    if (!onFiles || !files.length || !files.some((file) => file.type.startsWith("image/"))) {
      return false;
    }
    void Promise.resolve(editorRef.current && onFiles(editorRef.current, files));
    return true;
  }

  // Il valore cambiato da fuori (un collega, un ripristino, un altro record nel
  // pannello) entra nell'editor solo se non ci si sta scrivendo dentro: a chi
  // digita non si riscrive il documento sotto il cursore.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.getHTML();
    const next = plainToRichText(value);
    if (current !== next && value !== current) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value]);

  return <EditorContent editor={editor} className={fill ? "min-h-0 flex-1" : undefined} />;
}

export default RichTextEditor;
