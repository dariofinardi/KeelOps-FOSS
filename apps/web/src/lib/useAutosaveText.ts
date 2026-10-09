import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

/**
 * Campo di testo che si salva da solo mentre lo si scrive.
 *
 * Prima il salvataggio avveniva soltanto quando il campo perdeva il fuoco, e il
 * caso più comune non lo produce: si scrive nel titolo, si clicca fuori dal
 * pannello, il pannello si chiude — e la riga smontata non emette nessun blur.
 * Il testo spariva senza un avviso. Qui il salvataggio parte a digitazione ferma
 * (`delayMs`), e comunque prima che il campo scompaia.
 *
 * Regole della tastiera, uguali in tutti i pannelli:
 * - **Invio** salva subito ed esce dal campo (su textarea va a capo, e serve
 *   Ctrl/⌘+Invio per salvare);
 * - **Esc** butta la bozza e rimette il valore salvato **senza chiudere il
 *   pannello**; se non c'è niente da buttare, l'Esc prosegue e chiude come prima.
 *
 * Chi lo usa può ancora decidere alla chiusura: `flush()` manda quello che c'è
 * scritto, `discard()` lo abbandona (è la coppia "Mantieni / Torna com'era").
 */
export interface AutosaveTextOptions {
  /** Valore salvato, quello che arriva dal server. */
  value: string | null;
  /** Riceve il testo ripulito; per i campi che ammettono il vuoto arriva "". */
  onSave: (value: string) => void;
  /** Il campo non può restare vuoto (es. il titolo): svuotarlo non salva nulla. */
  required?: boolean;
  /** Input di una riga: Invio salva ed esce. Su textarea lasciare false. */
  singleLine?: boolean;
  /** Quanto silenzio aspettare prima di salvare da soli. */
  delayMs?: number;
}

export interface AutosaveText {
  value: string;
  /** C'è del testo scritto e non ancora salvato. */
  isDirty: boolean;
  /** Salva subito quello che c'è scritto (niente da salvare = non fa nulla). */
  flush: () => void;
  /** Abbandona la bozza e torna al valore salvato. */
  discard: () => void;
  /**
   * Sostituisce la bozza a mano. Serve ai campi che non sono `<input>` —
   * l'editor arricchito lavora su un documento e comunica il testo da sé —
   * così anche loro seguono le stesse regole di salvataggio invece di
   * inventarsene di proprie.
   */
  setValue: (next: string) => void;
  props: {
    value: string;
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onBlur: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  };
}

const clean = (text: string) => text.trim();

export function useAutosaveText({
  value,
  onSave,
  required = false,
  singleLine = false,
  delayMs = 800,
}: AutosaveTextOptions): AutosaveText {
  const saved = value ?? "";
  const [draft, setDraft] = useState(saved);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Ultimo valore visto dal server e ultimo testo mandato: insieme dicono se la
  // bozza è "roba nostra ancora da mandare" oppure l'eco di quello che c'è già.
  const serverRef = useRef(saved);
  const sentRef = useRef<string | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  if (serverRef.current !== saved) {
    const previous = serverRef.current;
    serverRef.current = saved;
    // Il valore salvato è cambiato: altro record nel pannello, ripristino, o la
    // modifica di un collega. La bozza lo segue solo se non stiamo scrivendo
    // qualcos'altro — chi sta digitando non si vede sparire il testo sotto le mani.
    const text = clean(draftRef.current);
    if (text === sentRef.current) {
      // È l'eco di quello che abbiamo appena mandato: il testo è già questo, e
      // riscriverlo toglierebbe di sotto le dita gli spazi che stiamo battendo
      // proprio adesso. Salvare ripulisce il testo, non ciò che si sta scrivendo:
      // "ciao " diventava "ciao" mentre l'utente stava andando avanti.
      sentRef.current = null;
    } else if (text === clean(previous)) {
      sentRef.current = null;
      draftRef.current = saved;
      setDraft(saved);
    }
  }

  const text = clean(draft);
  const isDirty = text !== clean(saved) && text !== sentRef.current && !(required && text === "");

  const flush = useCallback(() => {
    const current = clean(draftRef.current);
    if (required && current === "") return;
    if (current === clean(serverRef.current) || current === sentRef.current) return;
    sentRef.current = current;
    onSaveRef.current(current);
  }, [required]);

  const discard = useCallback(() => {
    sentRef.current = null;
    draftRef.current = serverRef.current;
    setDraft(serverRef.current);
  }, []);

  const setValue = useCallback((next: string) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  // Salvataggio a digitazione ferma.
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(flush, delayMs);
    return () => clearTimeout(timer);
  }, [draft, isDirty, flush, delayMs]);

  // Rete di sicurezza: il campo che sparisce (pannello chiuso con un clic fuori)
  // porta con sé quello che c'era scritto. Dopo flush/discard non fa nulla.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  return {
    value: draft,
    isDirty,
    flush,
    discard,
    setValue,
    props: {
      value: draft,
      onChange: (event) => setDraft(event.target.value),
      onBlur: () => {
        // Un titolo svuotato non è una modifica: torna quello che c'era.
        if (required && clean(draftRef.current) === "") discard();
        else flush();
      },
      onKeyDown: (event) => {
        if (event.key === "Escape") {
          // Niente da abbandonare: l'Esc va avanti e chiude il pannello.
          if (!isDirty) return;
          event.stopPropagation();
          discard();
          event.currentTarget.blur();
          return;
        }
        if (event.key !== "Enter") return;
        if (singleLine) {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          flush();
          event.currentTarget.blur();
        }
      },
    },
  };
}
