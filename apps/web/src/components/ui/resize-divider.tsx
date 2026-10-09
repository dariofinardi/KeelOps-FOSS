import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Il confine fra due regioni di un pannello, **che si può spostare**.
 *
 * Nasce dal pannello del task (20/08/2026): la conversazione ancorata era
 * separata dal resto da un filo grigio chiaro che praticamente non si vedeva, e
 * l'altezza era decisa da noi. Qui le due cose si risolvono insieme — il
 * divisore è la maniglia: una banda con un appiglio al centro, che si vede
 * perché è spessa e tinta, e che dichiara da sé di essere trascinabile.
 *
 * Si tira **verso l'alto per allargare** la regione di sotto. Il minimo è
 * l'altezza che la regione aveva prima che questo esistesse: si può crescere,
 * non rimpicciolire sotto quella.
 *
 * **Il trascinamento ascolta la finestra, non sé stesso.** Prima si affidava a
 * `setPointerCapture` sulla banda, e non funzionava: la banda è alta pochi
 * pixel, quindi al primo movimento il puntatore ne è già fuori, e se la cattura
 * non va a buon fine gli eventi finiscono a chi sta sotto. Con i due ascoltatori
 * su `window` il trascinamento continua ovunque vada il puntatore — anche fuori
 * dalla finestra, che è dove finisce tirando in fretta.
 *
 * **Si usa anche da tastiera**: è un `separator` focalizzabile, frecce su e giù
 * per spostarlo. Un comando che esiste solo per il mouse è un comando che metà
 * delle persone non ha.
 */
export function ResizeDivider({
  /** Altezza attuale della regione di sotto, in pixel. */
  value,
  onChange,
  min,
  max,
  label,
  /** A sinistra della banda quando la regione è chiusa: cosa c'è là sotto. */
  hint,
  /** In fondo a destra: di solito il comando che chiude e riapre la regione. */
  action,
  /** Chiusa: niente trascinamento, resta solo la banda con i suoi comandi. */
  disabled = false,
  className,
}: {
  value: number;
  onChange: (px: number) => void;
  min: number;
  max: number;
  label: string;
  hint?: ReactNode;
  action?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  /** Da dove è partito il trascinamento. `null` = non si sta trascinando. */
  const partenza = useRef<{ y: number; h: number } | null>(null);
  /** L'ultimo `onChange`, per non riagganciare gli ascoltatori a ogni render. */
  const ultimo = useRef({ onChange, min, max });
  ultimo.current = { onChange, min, max };

  useEffect(() => {
    const limita = (px: number) => Math.min(ultimo.current.max, Math.max(ultimo.current.min, px));
    const muovi = (event: PointerEvent) => {
      if (!partenza.current) return;
      // Verso l'alto = più grande: il puntatore tira il confine, e la regione
      // che cresce è quella sotto.
      ultimo.current.onChange(limita(partenza.current.h + (partenza.current.y - event.clientY)));
    };
    const molla = () => {
      partenza.current = null;
      document.body.classList.remove("select-none");
    };
    window.addEventListener("pointermove", muovi);
    window.addEventListener("pointerup", molla);
    window.addEventListener("pointercancel", molla);
    return () => {
      window.removeEventListener("pointermove", muovi);
      window.removeEventListener("pointerup", molla);
      window.removeEventListener("pointercancel", molla);
      molla();
    };
  }, []);

  const limita = (px: number) => Math.min(max, Math.max(min, px));

  return (
    <div
      className={cn(
        // Spessa e tinta: un bordo da un pixel nel colore dei bordi si perdeva
        // fra i riquadri della pagina.
        "flex h-6 flex-none items-center gap-2 border-t-2 border-muted-foreground/25",
        "bg-muted/50 pr-1 pl-3",
        className,
      )}
    >
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={Math.round(max)}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        title={disabled ? undefined : t("Trascina per cambiare l'altezza")}
        className={cn(
          "group flex h-full flex-1 items-center justify-center",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          disabled ? "cursor-default" : "cursor-row-resize",
        )}
        onPointerDown={(event) => {
          // Solo il tasto principale: col destro si apre un menù, non si
          // trascina. `?? 0` perché non tutti gli ambienti riempiono `button`
          // sugli eventi di puntatore, e un controllo che sbaglia qui non fa
          // partire il trascinamento affatto.
          if (disabled || (event.button ?? 0) !== 0) return;
          event.preventDefault();
          partenza.current = { y: event.clientY, h: value };
          // Trascinando in su si selezionerebbe il testo della pagina.
          document.body.classList.add("select-none");
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const passo = event.shiftKey ? 64 : 16;
          if (event.key === "ArrowUp") onChange(limita(value + passo));
          else if (event.key === "ArrowDown") onChange(limita(value - passo));
          else if (event.key === "Home") onChange(min);
          else if (event.key === "End") onChange(limita(max));
          else return;
          event.preventDefault();
        }}
      >
        {!disabled && (
          <span className="h-1 w-10 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
        )}
      </div>
      {action}
    </div>
  );
}
