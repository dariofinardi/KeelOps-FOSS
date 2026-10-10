// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "info" | "success" | "error";

/**
 * Un comando dentro l'avviso: «Invia ugualmente», «Annulla», «Riprova». È la
 * forma giusta quando l'avviso dice che qualcosa **non** è successo e c'è un
 * modo di farlo succedere lo stesso — altrimenti bisogna rifare tutto a mano,
 * e nel frattempo l'avviso è già sparito.
 */
export interface ToastAzione {
  etichetta: string;
  fai: () => void;
}

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: ToastTone;
  /** Quanto resta a schermo, in millisecondi. */
  duration: number;
  azione?: ToastAzione;
}

/** Quanto dura un avviso normale: il tempo di leggere una riga. */
const DEFAULT_DURATION = 4500;
/**
 * Con un comando dentro dura di più: quattro secondi e mezzo bastano per
 * leggere «non inviato», non per leggerlo, decidere e cliccare.
 */
const DURATION_CON_AZIONE = 12_000;

export interface ToastOptions {
  /**
   * Millisecondi a schermo. Da alzare quando c'è **da leggere** e non solo da
   * accorgersi: quattro secondi e mezzo bastano per "salvato", non per tre
   * righe di elenco (14/08/2026).
   */
  duration?: number;
  /** Un comando dentro l'avviso (vedi `ToastAzione`): allunga anche il tempo. */
  azione?: ToastAzione;
}

const ToastContext = createContext<
  (message: ReactNode, tone?: ToastTone, options?: ToastOptions) => void
>(() => undefined);

/**
 * Notifica non bloccante in basso a destra. Sparisce da sé, ma **il tempo si
 * ferma mentre ci si passa sopra**: un avviso che si porta via la riga che stai
 * leggendo è peggio di nessun avviso, e allungare il timer per tutti farebbe
 * restare in mezzo anche i "salvato".
 */
export function useToast() {
  return useContext(ToastContext);
}

const TONE_ICONS = { info: Info, success: CheckCircle2, error: AlertCircle } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const scheduleRemoval = useCallback(
    (id: number, delay: number) => {
      const previous = timers.current.get(id);
      if (previous) clearTimeout(previous);
      timers.current.set(
        id,
        setTimeout(() => remove(id), delay),
      );
    },
    [remove],
  );

  const toast = useCallback(
    (message: ReactNode, tone: ToastTone = "info", options?: ToastOptions) => {
      const id = nextId.current;
      nextId.current += 1;
      const duration =
        options?.duration ?? (options?.azione ? DURATION_CON_AZIONE : DEFAULT_DURATION);
      setToasts((prev) => [...prev.slice(-4), { id, message, tone, duration, azione: options?.azione }]);
      scheduleRemoval(id, duration);
    },
    [scheduleRemoval],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((item) => {
          const Icon = TONE_ICONS[item.tone];
          return (
            <div
              key={item.id}
              role={item.tone === "error" ? "alert" : "status"}
              // Il tempo si ferma mentre lo si legge, e riparta da capo quando
              // il puntatore se ne va: così un elenco di tre righe si legge
              // davvero, senza lasciare avvisi appiccicati sullo schermo.
              onMouseEnter={() => {
                const timer = timers.current.get(item.id);
                if (timer) clearTimeout(timer);
              }}
              onMouseLeave={() => scheduleRemoval(item.id, item.duration)}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-lg",
                item.tone === "error" && "border-destructive/50",
                item.tone === "success" && "border-green-600/50",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  item.tone === "error"
                    ? "text-destructive"
                    : item.tone === "success"
                      ? "text-green-600"
                      : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1 leading-relaxed">
                {item.message}
                {item.azione && (
                  <button
                    type="button"
                    className="mt-2 block rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                    onClick={() => {
                      // Prima si toglie l'avviso, poi si fa: se l'azione apre
                      // un'altra notifica, non deve trovarsi sopra la propria.
                      remove(item.id);
                      item.azione?.fai();
                    }}
                  >
                    {item.azione.etichetta}
                  </button>
                )}
              </div>
              <button
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => remove(item.id)}
                aria-label={t("Chiudi notifica")}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
