import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SectionTone } from "./section-icon";

/**
 * Un gruppo dentro un pannello di dettaglio: filo colorato a sinistra, etichetta
 * corta in maiuscoletto, e un velo di colore che sfuma subito.
 *
 * Nasce dal pannello del task (20/08/2026), cresciuto a dodici sezioni separate
 * da niente più che un po' di spazio. Scartato l'accordion — chiedere un clic per
 * sapere se un campo è compilato è peggio della lunghezza — e scartate le schede,
 * che nascondono: stato e cliente si leggono insieme e finirebbero in due posti.
 * Restano cinque gruppi che si riconoscono a colpo d'occhio senza togliere niente
 * dalla vista.
 *
 * **Il colore non decora**: dice di cosa parla quella parte, ed è lo stesso di
 * `SectionIcon` — chi lo impara nella pagina Sistema lo ritrova qui. Le classi
 * sono scritte per esteso perché Tailwind le raccoglie dal sorgente.
 */
const RAIL: Record<SectionTone, string> = {
  violet: "border-l-violet-400 dark:border-l-violet-500/70",
  amber: "border-l-amber-400 dark:border-l-amber-500/70",
  sky: "border-l-sky-400 dark:border-l-sky-500/70",
  emerald: "border-l-emerald-400 dark:border-l-emerald-500/70",
  rose: "border-l-rose-400 dark:border-l-rose-500/70",
  slate: "border-l-slate-400 dark:border-l-slate-500/70",
};

const LABEL: Record<SectionTone, string> = {
  violet: "text-violet-600 dark:text-violet-400",
  amber: "text-amber-600 dark:text-amber-400",
  sky: "text-sky-600 dark:text-sky-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  rose: "text-rose-600 dark:text-rose-400",
  slate: "text-slate-600 dark:text-slate-300",
};

export function PanelGroup({
  tone,
  title,
  /** Una riga corta a destra dell'etichetta: un conteggio, o cosa contiene. */
  meta,
  children,
  className,
}: {
  tone: SectionTone;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-r-md border-l-2 py-2.5 pr-1 pl-3", RAIL[tone], className)}>
      <header className="mb-2 flex items-baseline gap-2">
        <h3 className={cn("text-[11px] font-semibold tracking-wider uppercase", LABEL[tone])}>
          {title}
        </h3>
        {meta && <span className="ml-auto text-[11px] text-muted-foreground">{meta}</span>}
      </header>
      {children}
    </section>
  );
}
