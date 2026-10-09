import { useConfirm } from "@/components/ui/confirm";

/**
 * Uscire da un pannello non deve mai far sparire il lavoro in silenzio: qui stanno
 * le due domande che l'applicazione fa quando si chiude qualcosa con modifiche in
 * sospeso. Sono due perché i pannelli salvano in due modi diversi, e la scelta da
 * offrire cambia di conseguenza.
 *
 * In entrambi i casi vale la stessa regola: **il bottone principale è quello che
 * non fa perdere niente** — riceve il focus, risponde a Invio ed è anche l'esito di
 * ✕ e Esc; quello che scarta è secondario e in rosso.
 */

/**
 * true se almeno un campo si discosta dal valore di partenza. Le coppie sono
 * `[valore attuale, valore iniziale]`: nei moduli di creazione l'iniziale è la
 * stringa vuota, in quelli di modifica il valore del record.
 */
export function isDirtyForm(pairs: Array<[unknown, unknown]>): boolean {
  return pairs.some(([current, initial]) => current !== initial);
}

/** Chiusura di un pannello che salva campo per campo (dettaglio task, offerta, ticket). */
export function useKeepOrRevert(): (options: {
  /** Nomi dei campi modificati; vuoto = si chiude e basta. */
  changed: string[];
  /** Come chiamare il record nel messaggio: "il task", "l'offerta", "il ticket". */
  what: string;
  onKeep: () => void;
  onRevert: () => void;
}) => void {
  const confirm = useConfirm();
  return ({ changed, what, onKeep, onRevert }) => {
    if (changed.length === 0) {
      onKeep();
      return;
    }
    void confirm({
      title: "Mantenere le modifiche?",
      message:
        `Hai modificato: ${changed.join(", ")}.\n` +
        `Il pannello si chiude in entrambi i casi: le modifiche restano salvate, ` +
        `oppure ${what} torna com'era quando l'hai aperto.`,
      confirmLabel: "Mantieni le modifiche",
      cancelLabel: "Torna com'era",
      cancelTone: "danger",
      dismissValue: true,
    }).then((keep) => (keep ? onKeep() : onRevert()));
  };
}

/**
 * Chiusura di un modulo che salva alla conferma (dialog con Salva/Annulla, e i
 * moduli di creazione). Se quello che c'è scritto non è ancora salvabile — campi
 * obbligatori vuoti — non si può offrire "Salva": si offre di continuare a
 * scrivere, che è l'unica alternativa vera al buttare via.
 */
export function useSaveOrDiscard(): (options: {
  isDirty: boolean;
  /** false quando il modulo non è compilabile: l'unica uscita è scartare. */
  canSave: boolean;
  /** Cosa si sta scartando: "le modifiche" (default) o "il nuovo task". */
  what?: string;
  onSave: () => void;
  onDiscard: () => void;
}) => void {
  const confirm = useConfirm();
  return ({ isDirty, canSave, what = "le modifiche", onSave, onDiscard }) => {
    if (!isDirty) {
      onDiscard();
      return;
    }
    if (!canSave) {
      void confirm({
        title: "Chiudere senza salvare?",
        message: `Quello che hai scritto non è ancora completo: chiudendo, ${what} andranno perse.`,
        confirmLabel: "Continua a modificare",
        cancelLabel: "Chiudi e scarta",
        cancelTone: "danger",
        dismissValue: true,
      }).then((stay) => {
        if (!stay) onDiscard();
      });
      return;
    }
    void confirm({
      title: "Salvare le modifiche?",
      message: `Hai modifiche non salvate: puoi salvarle ora, oppure chiudere e perderle.`,
      confirmLabel: "Salva e chiudi",
      cancelLabel: "Chiudi senza salvare",
      cancelTone: "danger",
      dismissValue: true,
    }).then((save) => (save ? onSave() : onDiscard()));
  };
}
