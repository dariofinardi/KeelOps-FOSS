import { periodDays, periodKind } from "@kancrm/shared";
import { todayISO } from "@/features/tasks/task-utils";

/**
 * Il periodo del timesheet — settimana o mese — tradotto in giorni ed
 * etichette. Stava in testa a TimesheetPage quando la pagina era una sola;
 * ora la usano la griglia e il guscio, e vive per conto suo.
 */
export type ViewMode = "grid" | "summary" | "report";

export interface DayInfo {
  iso: string;
  dayNum: number;
  weekdayLabel: string;
  isWeekend: boolean;
  isToday: boolean;
}

/**
 * I giorni del periodo — trentuno o sette — con l'iniziale nella lingua attiva:
 * le lettere D-L-M erano italiane fisse anche in inglese o tedesco (trovato in
 * review), e l'elenco dei mesi scritto a mano è sparito con loro — nomi e
 * iniziali li sa `Intl`. Quali siano i giorni lo dice la regola condivisa.
 */
export function daysOfPeriod(period: string, locale: string): DayInfo[] {
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const today = todayISO();
  return periodDays(period).map((iso) => {
    const date = new Date(`${iso}T12:00:00Z`);
    const weekday = date.getUTCDay();
    return {
      iso,
      dayNum: date.getUTCDate(),
      weekdayLabel: weekdayFmt.format(date),
      isWeekend: weekday === 0 || weekday === 6,
      isToday: iso === today,
    };
  });
}

/** "Agosto 2026" nella lingua attiva, con l'iniziale maiuscola da titolo. */
export function monthYearLabel(month: string, locale: string): string {
  const label = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * L'intestazione del periodo: "Agosto 2026", oppure "3 – 9 agosto 2026" per una
 * settimana (col mese ripetuto quando è a cavallo: "31 ago – 6 set 2026").
 */
export function periodLabel(period: string, locale: string): string {
  if (periodKind(period) === "month") return monthYearLabel(period, locale);
  const days = periodDays(period);
  const first = new Date(`${days[0]!}T12:00:00Z`);
  const last = new Date(`${days[6]!}T12:00:00Z`);
  const sameMonth = days[0]!.slice(0, 7) === days[6]!.slice(0, 7);
  const dayFmt = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
  const dayMonthFmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const yearFmt = new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" });
  const start = sameMonth ? dayFmt.format(first) : dayMonthFmt.format(first);
  return `${start} – ${dayMonthFmt.format(last)} ${yearFmt.format(last)}`;
}

