/**
 * Il **periodo** del timesheet: un mese (`2026-08`) o una settimana
 * (`2026-08-03`, il lunedì che la apre).
 *
 * Il calendario nasce mensile; dal 12/08/2026 si può stringere alla settimana,
 * perché con trenta righe da compilare si finisce per non compilarne nessuna.
 * Invece di raddoppiare rotte e stati, il periodo è **una stringa sola** che
 * dice anche di che tipo è: il server ne ricava l'intervallo di date, il
 * browser le colonne, e il pulsante "aggiungi i task su cui ho lavorato" la
 * finestra in cui guardare. Le regole stanno qui, pure e provate, perché
 * client e server devono contare gli stessi giorni.
 *
 * Le date sono trattate in UTC come ovunque nel timesheet (le ore sono di un
 * giorno, non di un istante).
 */

export type PeriodKind = "month" | "week";

const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Mese o settimana? (una stringa non valida vale come mese: lo dirà lo schema) */
export function periodKind(period: string): PeriodKind {
  return DAY.test(period) ? "week" : "month";
}

export function isValidPeriod(period: string): boolean {
  if (MONTH.test(period)) return true;
  // Una settimana è identificata dal suo lunedì: accettare un mercoledì
  // vorrebbe dire due chiavi per la stessa settimana, e due righe "tenute a
  // mano" per lo stesso task.
  return DAY.test(period) && weekStartOf(period) === period;
}

/** Il lunedì della settimana che contiene la data indicata (YYYY-MM-DD). */
export function weekStartOf(dateISO: string): string {
  const date = new Date(`${dateISO}T12:00:00Z`);
  // getUTCDay(): 0 = domenica. La settimana lavorativa qui parte di lunedì.
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** I giorni del periodo, in ordine (YYYY-MM-DD). */
export function periodDays(period: string): string[] {
  if (periodKind(period) === "week") {
    const start = new Date(`${period}T12:00:00Z`);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
  }
  const [year, month] = period.split("-").map(Number) as [number, number];
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${period}-${String(index + 1).padStart(2, "0")}`,
  );
}

/** Intervallo del periodo: `from` incluso, `toExclusive` escluso (YYYY-MM-DD). */
export function periodRange(period: string): { from: string; toExclusive: string } {
  const days = periodDays(period);
  const from = days[0]!;
  const last = new Date(`${days[days.length - 1]!}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 1);
  return { from, toExclusive: last.toISOString().slice(0, 10) };
}

/**
 * I mesi che il periodo tocca: uno, o **due** per la settimana a cavallo. Serve
 * ai lucchetti — chiudere agosto deve bloccare il 31 agosto anche a chi sta
 * guardando la settimana che arriva al 6 settembre.
 */
export function periodMonths(period: string): string[] {
  const months = new Set(periodDays(period).map((day) => day.slice(0, 7)));
  return [...months];
}

/**
 * Il mese "di appartenenza" di un periodo, per ciò che resta mensile (lucchetto,
 * export, report). Per una settimana a cavallo vale il mese del **giovedì**: è
 * la regola ISO 8601 delle settimane, ed evita che la settimana del 31 agosto
 * finisca sotto settembre solo perché ne contiene quattro giorni.
 */
export function monthOfPeriod(period: string): string {
  if (periodKind(period) === "month") return period;
  return periodDays(period)[3]!.slice(0, 7);
}

/** Periodo precedente/successivo: un mese o una settimana, secondo il tipo. */
export function shiftPeriod(period: string, delta: number): string {
  if (periodKind(period) === "week") {
    const date = new Date(`${period}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 7 * delta);
    return date.toISOString().slice(0, 10);
  }
  const [year, month] = period.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Cambio di lente, restando dove si è: da mese a settimana si va a quella di
 * **oggi** se il mese è quello corrente (è lì che si sta rendicontando),
 * altrimenti alla prima settimana che comincia nel mese guardato.
 */
export function toWeekPeriod(period: string, today: string): string {
  if (periodKind(period) === "week") return period;
  if (today.startsWith(period)) return weekStartOf(today);
  const first = weekStartOf(`${period}-01`);
  // Il lunedì può cadere nel mese precedente: in quel caso si parte dal lunedì
  // successivo, che è la prima settimana davvero di questo mese.
  return first.slice(0, 7) === period ? first : shiftPeriod(first, 1);
}

/** Da settimana a mese: quello di appartenenza. */
export function toMonthPeriod(period: string): string {
  return monthOfPeriod(period);
}
