import { useTranslation } from "react-i18next";
import { CalendarClock, Plus } from "lucide-react";
import { StatoPasso, statoPasso, type FiltroOfferteFerme } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { ColorPill } from "@/components/ui/color-pill";
import { formatDate } from "@/features/tasks/task-utils";

/**
 * **Il prossimo passo di un'offerta**, in una riga (17/09/2026).
 *
 * Un solo componente per la tabella delle offerte, le card della pipeline e
 * l'area del monitor vendite: la regola di cosa è scaduto e cosa no sta in
 * `deal-next-step.ts`, e qui si decide solo come scriverlo.
 *
 * Due dettagli di lettura. **Completo** per chi lavora dentro: titolo del task,
 * chi lo fa e quando. Per il monitor vendite **di cosa si tratta**: tipo di
 * attività, titolo e data (01/10/2026) — chi lo fa il server non lo manda.
 */
export function ProssimoPasso({
  passo,
  conclusa,
  oggi,
  altri = 0,
  onApri,
  onAggiungi,
  compatto = false,
}: {
  passo: {
    dueDate: string | null;
    title?: string;
    assigneeName?: string | null;
    /** Il tipo di attività del task, come pastiglia prima del titolo. */
    type?: { name: string; color: string } | null;
  } | null;
  /** Vinta o persa: non ha passi da fare, e non si segnala come ferma. */
  conclusa: boolean;
  /** Il giorno di oggi nel fuso aziendale (YYYY-MM-DD). */
  oggi: string;
  /** Altri task aperti oltre al passo mostrato. */
  altri?: number;
  /** Apre il task del passo. */
  onApri?: () => void;
  /** Crea un task collegato: si offre quando il passo manca. */
  onAggiungi?: () => void;
  /** Una riga sola, piccola: per le card. */
  compatto?: boolean;
}) {
  const { t } = useTranslation();
  if (conclusa) return <span className="text-muted-foreground">—</span>;

  const stato = statoPasso(passo, oggi);
  if (stato === StatoPasso.NESSUNO) {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
        {t("Nessun passo")}
        {onAggiungi && (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded px-1 text-xs font-medium text-primary hover:bg-muted"
            title={t("Aggiungi un task collegato all'offerta")}
            onClick={(event) => {
              // La riga intera apre l'offerta: qui si vuole il task, non il dettaglio.
              event.stopPropagation();
              onAggiungi();
            }}
          >
            <Plus className="size-3" aria-hidden />
            {t("Aggiungi")}
          </button>
        )}
      </span>
    );
  }

  const quando =
    stato === StatoPasso.SENZA_DATA
      ? t("senza data")
      : stato === StatoPasso.OGGI
        ? t("oggi")
        : formatDate(passo!.dueDate!);
  const tonoData = cn(
    stato === StatoPasso.SCADUTO && "font-medium text-destructive",
    stato === StatoPasso.OGGI && "font-medium text-primary",
    (stato === StatoPasso.IN_PROGRAMMA || stato === StatoPasso.SENZA_DATA) &&
      "text-muted-foreground",
  );
  const aiuto =
    stato === StatoPasso.SCADUTO
      ? t("Il prossimo passo è scaduto")
      : stato === StatoPasso.SENZA_DATA
        ? t("Il prossimo passo non ha una data")
        : t("Prossimo passo");

  // Solo la data: il monitor vendite, o chi non ha il titolo del task.
  if (!passo!.title) {
    return (
      <span className={cn("inline-flex items-center gap-1", tonoData)} title={aiuto}>
        <CalendarClock className="size-3 shrink-0" aria-hidden />
        {quando}
      </span>
    );
  }

  const contenuto = (
    <>
      {passo!.type && <ColorPill color={passo!.type.color} label={passo!.type.name} dot="small" />}
      <span
        className={cn("truncate text-foreground", compatto ? "max-w-[10rem]" : "max-w-[14rem]")}
      >
        {passo!.title}
      </span>
      <span className={cn("shrink-0", tonoData)} title={aiuto}>
        {quando}
      </span>
      {!compatto && passo!.assigneeName && (
        <span className="shrink-0 text-muted-foreground">· {passo!.assigneeName}</span>
      )}
      {altri > 0 && (
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={t("{{count}} altri task aperti collegati", { count: altri })}
        >
          +{altri}
        </span>
      )}
    </>
  );
  return onApri ? (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1.5 rounded text-left hover:underline"
      title={`${passo!.title} — ${aiuto}`}
      onClick={(event) => {
        event.stopPropagation();
        onApri();
      }}
    >
      {contenuto}
    </button>
  ) : (
    <span className="inline-flex max-w-full items-center gap-1.5" title={passo!.title}>
      {contenuto}
    </span>
  );
}

/** Le voci del filtro «Ferme», nell'ordine in cui si mostrano. */
export const VOCI_OFFERTE_FERME: Array<{ value: FiltroOfferteFerme; label: string }> = [
  { value: "tutte", label: "Ferme" },
  { value: "senzaPasso", label: "Senza prossimo passo" },
  { value: "passoScaduto", label: "Prossimo passo scaduto" },
  { value: "chiusuraPassata", label: "Chiusura prevista passata" },
];
