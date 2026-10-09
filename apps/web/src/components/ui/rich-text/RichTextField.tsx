import { Suspense, lazy, useCallback, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Bold, Italic, List, ListOrdered, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserOptions } from "@/features/tasks/useTasks";
import { useMentionPopup } from "./MentionPopup";
import { RichText } from "./RichText";
import { RichTextDialog } from "./RichTextDialog";

// ProseMirror pesa: entra in gioco quando si apre un pannello, non prima.
const RichTextEditor = lazy(() => import("./editor").then((m) => ({ default: m.RichTextEditor })));

/**
 * Campo descrittivo con formattazione.
 *
 * Non decide da sé quando salvare: riceve il campo autosalvante del pannello
 * (`useAutosaveText`), lo stesso di titolo e note. Così la descrizione segue le
 * regole di tutti gli altri campi — salvataggio a scrittura ferma, salvataggio
 * comunque prima di sparire, Esc che abbandona la bozza — e la domanda
 * "Mantieni / Torna com'era" alla chiusura continua a contarla.
 *
 * Mentre l'editor si carica il testo si vede già, disegnato: chi apre un
 * pannello per leggere non aspetta niente.
 */
/**
 * Da dove viene e dove va il testo.
 *
 * Nei pannelli è il campo autosalvante (`useAutosaveText`), che oltre al valore
 * porta la bozza: c'è del non salvato, mandalo, buttalo. Nei form di creazione
 * non c'è niente da salvare finché non si preme "Crea", quindi bastano il
 * valore e come cambiarlo — e l'editor non deve sapere in quale dei due casi si
 * trova. `AutosaveText` soddisfa già questa forma: nessun adattatore in mezzo.
 */
export interface RichTextTarget {
  value: string;
  setValue: (html: string) => void;
  /** Presenti solo dove il campo si salva da sé. */
  isDirty?: boolean;
  flush?: () => void;
  discard?: () => void;
}

export interface RichTextFieldProps {
  field: RichTextTarget;
  placeholder?: string;
  className?: string;
  /** Strumenti aggiuntivi a destra della barra (es. la finestra grande). */
  actions?: React.ReactNode;
  /** Chi non può modificare legge e basta: niente barra, niente editor. */
  readOnly?: boolean;
  /**
   * Task delle figure incollate. C'è = si apre la finestra grande con tabelle e
   * immagini; non c'è (record ancora da creare) = si scrive e basta.
   */
  taskId?: string | null;
  /**
   * Vale per i form di **creazione**: le figure incollate restano in attesa e
   * traslocano accanto al record appena viene salvato. Da accendere solo dove
   * chi salva chiama `bindPendingImages` lato server — altrimenti resterebbero
   * in attesa e sparirebbero dopo due giorni.
   */
  pendingImages?: boolean;
  /** Titolo della finestra grande: dice su cosa si sta scrivendo. */
  dialogTitle?: string;
}

export function RichTextField({
  field,
  placeholder,
  className,
  actions,
  readOnly = false,
  taskId,
  pendingImages = false,
  dialogTitle,
}: RichTextFieldProps) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Chi si può nominare: l'elenco che il server già filtra per permessi, lo
  // stesso delle tendine di assegnatario e supervisore. Scrivere "@" non deve
  // rivelare l'organigramma a chi non lo vede.
  const { data: people } = useUserOptions(!readOnly);
  const mention = useMentionPopup(() => (people ?? []).map((u) => ({ id: u.id, name: u.name })));

  if (readOnly) {
    return (
      <div className={cn("rounded-md border bg-muted/30 p-3", className)}>
        {field.value ? (
          <RichText value={field.value} />
        ) : (
          <span className="text-sm text-muted-foreground">{placeholder ?? "—"}</span>
        )}
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // La finestra grande è renderizzata dentro questo wrapper: quando è aperta,
    // il suo Esc lo gestisce lei (chiude la finestra). Trattenerlo qui butterebbe
    // la bozza lasciando la finestra aperta — né la chiusura né il testo.
    if (expanded) return;
    if (event.key === "Escape") {
      // Stessa regola degli altri campi: l'Esc butta la bozza e il pannello
      // resta aperto; senza niente da buttare prosegue e chiude. In un form di
      // creazione non c'è bozza da buttare: l'Esc passa e chiude la finestra,
      // che chiederà lei se tenere quello che si stava scrivendo.
      if (!field.isDirty || !field.discard) return;
      event.stopPropagation();
      field.discard();
      editor?.commands.blur();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && field.flush) {
      event.preventDefault();
      field.flush();
      editor?.commands.blur();
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)} onKeyDown={onKeyDown}>
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          editor={editor}
          label={t("Grassetto (Ctrl+B)")}
          active="bold"
          onClick={(chain) => chain.toggleBold().run()}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Corsivo (Ctrl+I)")}
          active="italic"
          onClick={(chain) => chain.toggleItalic().run()}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Elenco puntato")}
          active="bulletList"
          onClick={(chain) => chain.toggleBulletList().run()}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label={t("Elenco numerato")}
          active="orderedList"
          onClick={(chain) => chain.toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <div className="ml-auto flex items-center gap-0.5">
          {actions}
          <button
            type="button"
            title={t("Apri l'editor grande (tabelle, immagini)")}
            aria-label={t("Apri l'editor grande")}
            onClick={() => setExpanded(true)}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>
      <Suspense
        fallback={
          <div className="min-h-24 rounded-md border bg-background p-3 text-sm opacity-60">
            <RichText value={field.value || null} />
          </div>
        }
      >
        <RichTextEditor
          value={field.value}
          onChange={field.setValue}
          placeholder={placeholder}
          onReady={setEditor}
          // Schema completo (tabelle e figure) anche qui: la barra compatta non
          // offre quei comandi, ma senza i nodi nello schema il sync scarterebbe
          // ciò che la finestra grande ha scritto, e il primo tasto digitato lo
          // salverebbe mutilato — perdita dati.
          rich
          mentions={{ people: mention.people, render: mention.render }}
        />
      </Suspense>
      {mention.node}
      {/* Stessa bozza, stesso salvataggio: la finestra grande è solo più spazio. */}
      <RichTextDialog
        open={expanded}
        onClose={() => setExpanded(false)}
        title={dialogTitle ?? t("Descrizione")}
        value={field.value}
        onChange={field.setValue}
        taskId={taskId ?? null}
        pendingImages={pendingImages}
        placeholder={placeholder}
        mentions={{ people: mention.people, render: mention.render }}
      />
    </div>
  );
}

/**
 * Un pulsante della barra. Mostra se lo stile è **attivo dove sta il cursore**:
 * una barra che non lo dice costringe a scrivere per scoprirlo.
 */
export function ToolbarButton({
  editor,
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  editor: Editor | null;
  label: string;
  /** Nome dello stile da interrogare (`editor.isActive`). */
  active?: string;
  disabled?: boolean;
  onClick: (chain: ReturnType<Editor["chain"]>) => void;
  children: React.ReactNode;
}) {
  const isActive = !!active && !!editor?.isActive(active);
  const run = useCallback(() => {
    if (editor) onClick(editor.chain().focus());
  }, [editor, onClick]);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ? isActive : undefined}
      disabled={disabled || !editor}
      onClick={run}
      // Il clic non deve portarsi via il fuoco dall'editor, altrimenti lo stile
      // si applicherebbe a una selezione che nel frattempo non c'è più.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40",
        isActive && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}
