import {
  ArrowDownUp,
  Building2,
  CalendarClock,
  CircleDot,
  Coins,
  Flag,
  Shapes,
  Tags,
  Timer,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { AREAS } from "@/components/layout/areas";
import { cn } from "@/lib/utils";

/**
 * I segni dei filtri: **una cosa, un'icona, in tutta l'applicazione**.
 *
 * Una tendina dice cosa filtra solo dalla sua voce predefinita ("Tutti gli
 * stati"), che si legge quando la si guarda da vicino; in fila con altre tre
 * diventa un muro di parole grigie. L'icona la si riconosce prima di leggere —
 * ma solo se è **la stessa in ogni barra**: due segni diversi per lo stesso
 * filtro in due viste costano più di nessun segno, perché insegnano una cosa
 * falsa (17/08/2026).
 *
 * Da non confondere con `AREAS` (dove porta un collegamento) e con
 * `MODULE_META` (che natura ha un task): qui si dice **su che cosa taglia** un
 * filtro. Il progetto prende l'icona da `AREAS`, perché "progetto" è la stessa
 * cosa in tutte e due i registri.
 */
export const FILTER_ICONS = {
  /** Stato del record: il pallino è quello che le pastiglie portano dentro. */
  status: CircleDot,
  /** Fase di un'offerta: è lo stato della pipeline, stesso segno. */
  stage: CircleDot,
  priority: Flag,
  project: AREAS.projects.icon,
  /** Persona: assegnatario, richiedente, intestatario. */
  person: User,
  /** Insieme di persone: squadra, timesheet di altri. */
  people: Users,
  company: Building2,
  /** Tipo di attività: che genere di lavoro è. */
  activityType: Shapes,
  tag: Tags,
  /** Scadenza come intervallo ("entro 7 giorni"). */
  dueRange: Timer,
  /** Un periodo di calendario: mese, settimana, giorno. */
  period: CalendarClock,
  /** Importo, valore economico. */
  amount: Coins,
  sort: ArrowDownUp,
} satisfies Record<string, LucideIcon>;

export type FilterIcon = keyof typeof FILTER_ICONS;

/**
 * La tendina di un filtro: icona, `select`, e la stessa scatola in ogni barra.
 *
 * L'involucro è un `<label>` e non un `<div>`: così il clic sull'icona apre la
 * tendina e chi usa uno screen reader sente a che cosa serve — le barre dei
 * filtri non hanno etichette scritte, quindi senza questo la tendina si
 * annuncia col nome della prima voce.
 *
 * Alta 40px sul telefono e 36 da tablet in su, come pulsanti e campi (vedi
 * `button.tsx`): una barra dove un comando su tre è più basso degli altri si
 * nota subito.
 */
export function FilterSelect({
  icon,
  label,
  value,
  onChange,
  className,
  children,
}: {
  icon: FilterIcon;
  /** A cosa serve: diventa il titolo al passaggio del mouse e l'etichetta ARIA. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const Icon = FILTER_ICONS[icon];
  return (
    <label
      className={cn(
        "flex h-10 items-center gap-1 rounded-md border bg-background pl-2 text-sm sm:h-9",
        className,
      )}
      title={label}
    >
      {/*
        Colore dell'**accento del tema** e non il grigio dei testi secondari: in
        grigio le icone erano un wireframe, si vedevano solo cercandole. Il
        primario cambia col tema aziendale scelto (viola, blu,
        verde acqua), quindi la barra resta coerente con il resto senza
        introdurre un colore nuovo (17/08/2026).
      */}
      <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <select
        className="h-full min-w-0 rounded-md bg-background pr-1 text-sm outline-none"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
