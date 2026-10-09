/**
 * **La tastiera nella griglia delle ore, come in un foglio di calcolo.**
 *
 * Una casella ha due stati, ed è la distinzione che fa tutto il resto:
 * **selezionata** (si è lì, ma non si sta scrivendo) e **in scrittura**. Da
 * selezionata le frecce spostano; appena si digita una cifra si entra in
 * scrittura con quella cifra dentro; Invio conferma e scende, Esc rimette il
 * valore di prima. È quello che le dita di chiunque si aspettano da una
 * griglia (richiesta del 26/08/2026).
 *
 * Qui c'è **solo la traduzione tasto → intenzione**, senza DOM e senza React:
 * è la parte che si può sbagliare in silenzio, e così si prova per intero.
 */

export type GridIntent =
  /** Spostati di righe/colonne, senza toccare il valore. */
  | { kind: "move"; dr: number; dc: number }
  /** Vai a inizio/fine riga (Home/Fine). */
  | { kind: "edge"; to: "start" | "end" }
  /** Entra in scrittura; `char` è il primo carattere digitato, se c'è. */
  | { kind: "edit"; char?: string }
  /** Conferma quello che c'è scritto e spostati. */
  | { kind: "commit"; dr: number; dc: number }
  /** Annulla la scrittura: torna al valore di prima, resta selezionata. */
  | { kind: "cancel" }
  /** Svuota la casella (Canc/Backspace da selezionata). */
  | { kind: "clear" }
  /** Niente di nostro: il tasto prosegue per la sua strada. */
  | null;

export interface GridKey {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** Un carattere che può iniziare un numero di ore: cifre e separatori. */
const INIZIA_UN_NUMERO = /^[0-9.,]$/;

export function intentOf(event: GridKey, editing: boolean): GridIntent {
  // Le scorciatoie del browser e del sistema restano loro: Ctrl+C copia, e
  // Alt+← torna indietro nella cronologia.
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  if (editing) {
    switch (event.key) {
      case "Enter":
        // Come nel foglio di calcolo: conferma e scende (con Shift, sale).
        return { kind: "commit", dr: event.shiftKey ? -1 : 1, dc: 0 };
      case "Tab":
        return { kind: "commit", dr: 0, dc: event.shiftKey ? -1 : 1 };
      case "Escape":
        return { kind: "cancel" };
      case "ArrowUp":
        return { kind: "commit", dr: -1, dc: 0 };
      case "ArrowDown":
        return { kind: "commit", dr: 1, dc: 0 };
      // Sinistra e destra muovono il CURSORE dentro il testo: mentre si scrive
      // "4,5" servono a correggere, non a cambiare casella.
      default:
        return null;
    }
  }

  switch (event.key) {
    case "ArrowUp":
      return { kind: "move", dr: -1, dc: 0 };
    case "ArrowDown":
      return { kind: "move", dr: 1, dc: 0 };
    case "ArrowLeft":
      return { kind: "move", dr: 0, dc: -1 };
    case "ArrowRight":
      return { kind: "move", dr: 0, dc: 1 };
    case "Tab":
      return { kind: "move", dr: 0, dc: event.shiftKey ? -1 : 1 };
    case "Home":
      return { kind: "edge", to: "start" };
    case "End":
      return { kind: "edge", to: "end" };
    case "Enter":
    case "F2":
      // Invio su una casella selezionata apre la scrittura: confermare non ha
      // senso finché non si è scritto niente.
      return { kind: "edit" };
    case "Delete":
    case "Backspace":
      return { kind: "clear" };
    default:
      // Digitare una cifra entra in scrittura e la porta dentro: è il gesto
      // più frequente della griglia, e non deve costare un doppio clic.
      return event.key.length === 1 && INIZIA_UN_NUMERO.test(event.key)
        ? { kind: "edit", char: event.key }
        : null;
  }
}
