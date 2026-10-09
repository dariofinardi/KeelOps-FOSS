import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Dialog } from "./dialog";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /**
   * Segnala il bottone di sinistra come azione che comporta una perdita (testo in
   * rosso). Serve quando la scelta pericolosa NON è quella principale: il primario
   * riceve il focus e risponde a Invio, quindi deve restare l'opzione sicura.
   */
  cancelTone?: "default" | "danger";
  /**
   * Esito quando si esce senza scegliere (✕ o Esc). Di norma è `false`, cioè
   * "non fare nulla"; va portato a `true` quando è il bottone principale a essere
   * l'opzione innocua, altrimenti premere Esc farebbe la cosa distruttiva.
   */
  dismissValue?: boolean;
  /**
   * **Solo un avviso**: un bottone, niente scelta. Serve quando non c'è niente
   * da decidere ma qualcosa da sapere — "questa cosa non l'ho fatta, e ti dico
   * perché". Con due bottoni che fanno la stessa cosa, chi legge cerca la
   * differenza e non la trova.
   */
  dismissOnly?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

/** Conferma modale accessibile (sostituisce window.confirm). */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const answer = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Dialog
          open
          onClose={() => answer(pending.options.dismissValue ?? false)}
          title={pending.options.title}
        >
          {pending.options.message && (
            <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">
              {pending.options.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {!pending.options.dismissOnly && (
              <Button
                variant="outline"
                className={
                  pending.options.cancelTone === "danger"
                    ? "text-destructive hover:text-destructive"
                    : undefined
                }
                onClick={() => answer(false)}
              >
                {pending.options.cancelLabel ?? t("Annulla")}
              </Button>
            )}
            <Button
              variant={pending.options.tone === "danger" ? "destructive" : "default"}
              data-autofocus
              onClick={() => answer(true)}
            >
              {pending.options.confirmLabel ?? t("Conferma")}
            </Button>
          </div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}
