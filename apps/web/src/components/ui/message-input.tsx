import { forwardRef, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Il campo con cui si scrive un messaggio: chat dei task, delle offerte, dei
 * ticket, e l'area dei monitor vendite.
 *
 * Era un `<input>`, cioè una riga sola: **a capo non si poteva andare** — non
 * per scelta, per costruzione — e un messaggio con due punti elenco andava
 * scritto tutto di fila. Qui è una `<textarea>` che **cresce con il testo** (da
 * una riga fino a sei, poi scorre): parte bassa come prima, quindi la chat non
 * perde spazio a chi scrive una riga sola.
 *
 * Le due mosse, come in ogni messaggistica: **Invio manda**, **Shift+Invio va a
 * capo**. L'inverso (a capo con Invio, invio con un pulsante) si sarebbe
 * scontrato con l'abitudine di chiunque, e con il fatto che qui si scrivono
 * soprattutto messaggi corti.
 *
 * `onKeyDown` di chi lo ospita gira **prima**: se ha già gestito il tasto (una
 * tendina di menzioni aperta che con Invio sceglie la persona) chiama
 * `preventDefault()` e qui non si manda niente. È l'unico modo di far convivere
 * due significati dello stesso tasto senza che uno dei due si dimentichi
 * dell'altro.
 */
export interface MessageInputProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Invio (senza Shift): manda. Nessun `onSend` = il tasto non fa niente di speciale. */
  onSend?: () => void;
  /** Righe massime prima di scorrere. Sei bastano a leggere un messaggio intero. */
  maxRows?: number;
}

/** Altezza di una riga in px, coerente con `text-sm` (14px · 1.5). */
const LINE_HEIGHT = 21;
/** Imbottitura verticale del campo (py-2 sopra e sotto) più i due bordi. */
const CHROME = 18;

export const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  ({ className, onSend, onKeyDown, maxRows = 6, value, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    // Cresce col contenuto: si azzera l'altezza e si rilegge lo `scrollHeight`,
    // altrimenti il campo cresce e non torna più indietro quando si cancella.
    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, maxRows * LINE_HEIGHT + CHROME)}px`;
    }, [value, maxRows]);

    return (
      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={1}
        value={value}
        className={cn(
          "flex min-h-9 w-full resize-none overflow-y-auto rounded-md border bg-background px-3 py-2 text-sm leading-normal shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            // Senza questo la textarea ci mette anche un a capo, e il messaggio
            // successivo nascerebbe con una riga vuota davanti.
            event.preventDefault();
            onSend?.();
          }
        }}
        {...props}
      />
    );
  },
);
MessageInput.displayName = "MessageInput";
