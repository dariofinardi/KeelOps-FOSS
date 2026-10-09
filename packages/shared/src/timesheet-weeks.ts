import { weekStartOf } from "./timesheet-period";

/**
 * **Il mese diviso per settimane, senza perdere un giorno.**
 *
 * Le righe sono settimane perché il contratto è settimanale, ma il mese è
 * quello del calendario: **tutti** i suoi giorni, compresi quelli delle
 * settimane a cavallo. Agosto 2026 comincia di sabato — l'1 e il 2 sono un
 * frammento della settimana del 27 luglio — e finisce il 31, che è un lunedì
 * solo della settimana dopo. Ritagliare sul giovedì (la regola ISO che vale per
 * il lucchetto) faceva sparire quei giorni dai conti: 300,6 ore invece di
 * 306,7, e una domanda legittima su dove fossero finite le altre sei
 * (21/08/2026).
 *
 * Ogni riga porta quindi **solo i giorni suoi che stanno nel mese**, e le ore
 * dovute si contano su quelli: un frammento di due giorni non vale una
 * settimana di contratto. I fine settimana non entrano nel dovuto — ma le ore
 * segnate di sabato o domenica **si contano**, perché lavorate sono.
 */

export interface FrammentoSettimana {
  /** Il lunedì della settimana ISO a cui il frammento appartiene. */
  week: string;
  /** Primo e ultimo giorno **dentro il mese**. */
  from: string;
  to: string;
  /** Tutti i giorni del frammento, feriali e non. */
  days: string[];
  /** Giorni feriali (lunedì–venerdì) del frammento: la base delle ore dovute. */
  workdays: string[];
  /** La settimana è tagliata dal confine del mese. */
  partial: boolean;
}

function avanti(dateISO: string, giorni: number): string {
  const data = new Date(`${dateISO}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + giorni);
  return data.toISOString().slice(0, 10);
}

function feriale(dateISO: string): boolean {
  const giorno = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  return giorno >= 1 && giorno <= 5;
}

/** I giorni del mese, in ordine. */
export function daysOfMonth(month: string): string[] {
  const giorni: string[] = [];
  let giorno = `${month}-01`;
  while (giorno.slice(0, 7) === month) {
    giorni.push(giorno);
    giorno = avanti(giorno, 1);
  }
  return giorni;
}

/** Le settimane del mese, ognuna coi soli giorni che nel mese ci stanno. */
export function weeksOfMonth(month: string): FrammentoSettimana[] {
  const perSettimana = new Map<string, string[]>();
  for (const giorno of daysOfMonth(month)) {
    const lunedi = weekStartOf(giorno);
    perSettimana.set(lunedi, [...(perSettimana.get(lunedi) ?? []), giorno]);
  }
  return [...perSettimana.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, days]) => ({
      week,
      from: days[0]!,
      to: days[days.length - 1]!,
      days,
      workdays: days.filter(feriale),
      partial: days.length < 7,
    }));
}

/** A quale settimana (lunedì) appartiene un giorno. */
export const weekOf = weekStartOf;

/**
 * Quanto rende una percentuale di ore fatte sulle dovute. `null` quando le
 * dovute sono zero: dividere per zero direbbe che chi non ha contratto è
 * infinitamente produttivo.
 */
export function copertura(reali: number, teoriche: number): number | null {
  if (teoriche <= 0) return null;
  return Math.round((reali / teoriche) * 100);
}
