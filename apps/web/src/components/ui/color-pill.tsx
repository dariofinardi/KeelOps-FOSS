import { cn } from "@/lib/utils";

/**
 * La pastiglia colorata con il pallino: **un solo posto** per stati dei task,
 * fasi delle offerte e tipi di attività.
 *
 * Erano tre copie identiche a meno del tipo del dato, e infatti sono divergute
 * al primo ritocco: la richiesta "gli stati su una riga sola" (15/08/2026)
 * andava applicata tre volte, e la terza ce la si dimenticava.
 *
 * Due regole che valgono per tutte:
 *  - **mai a capo**: una pastiglia spezzata in due righe dentro il bordo tondo
 *    non si legge come un'etichetta, sembra un errore di disegno. Chi la
 *    contiene si prende lo spazio che serve (le tabelle sono a larghezza
 *    automatica, e il titolo accanto sa accorciarsi da solo);
 *  - **il colore lo decide il dato**, non il tema: arriva dalla configurazione
 *    di stati, fasi e tipi, quindi è uno `style` e non una classe.
 */
export function ColorPill({
  color,
  label,
  dot = "normal",
  title,
  className,
  pulse = false,
  pulseLabel,
}: {
  color: string;
  label: string;
  /** Il pallino: più piccolo sui tipi di attività, che stanno accanto ai titoli. */
  dot?: "normal" | "small";
  title?: string;
  className?: string;
  /**
   * Il pallino **lampeggia**, l'etichetta resta ferma: è il segnale «c'è
   * qualcosa di nuovo qui» (i messaggi non letti di un ticket). Batte fra il
   * colore dello stato e il bianco — la regola sta in `.pallino-lampeggia`,
   * in index.css — e a chi non lo vede lo dice `pulseLabel`.
   */
  pulse?: boolean;
  pulseLabel?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        dot === "small" ? "gap-1 px-2" : "gap-1.5",
        className,
      )}
      style={{ borderColor: color, color }}
      title={title ?? (pulse ? pulseLabel : undefined)}
    >
      <span
        className={cn(
          "rounded-full",
          dot === "small" ? "size-1.5" : "size-2",
          pulse && "pallino-lampeggia",
        )}
        style={{ backgroundColor: color }}
      />
      {pulse && pulseLabel ? <span className="sr-only">{pulseLabel}</span> : null}
      {label}
    </span>
  );
}
