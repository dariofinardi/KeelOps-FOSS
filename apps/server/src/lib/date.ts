/**
 * **Le date del dominio: giorni, non istanti.**
 *
 * Scadenze, ricorrenze e timesheet ragionano per giornate a mezzanotte UTC
 * (convenzione di CLAUDE.md). Questi quattro attrezzi esistevano in sette copie
 * sparse per i moduli, e due si erano già scritte in dialetti diversi: qui ce
 * n'è una sola per ciascuno, con i test accanto.
 */

/** `YYYY-MM-DD` → mezzanotte UTC. Per input **fidato** (dal database, da zod). */
export function dateOnlyToUTC(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Come sopra, ma per input **non fidato** (payload grezzi, file importati):
 * qualunque cosa non sia esattamente una data valida torna `null`, mai una
 * `Invalid Date` che avvelena i confronti tre funzioni più in là.
 */
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(date.getTime())) return null;
  // Il giro completo smaschera lo scavalcamento: `Date.UTC` accetta «mese 13»
  // e lo trasforma in gennaio dell'anno dopo — la copia originale se lo beveva
  // (trovato scrivendo questo test, 22/08/2026). Se rileggendola la data non è
  // quella scritta, non era una data.
  return toDateOnly(date) === value ? date : null;
}

/** `Date` → `YYYY-MM-DD` (UTC). Il `null` passa attraverso, per i campi facoltativi. */
export function toDateOnly(date: Date): string;
export function toDateOnly(date: Date | null): string | null;
export function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** La mezzanotte UTC di oggi (o del `now` passato, nei test). */
export function startOfTodayUTC(now = new Date()): Date {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

/** Il lunedì della settimana di `date`, a mezzanotte UTC. */
export function mondayOf(date: Date): Date {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday;
}

const ROME_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Il giorno di calendario (YYYY-MM-DD) di un istante, letto nel fuso aziendale
 * (Europe/Rome, l'unico: vedi CLAUDE.md). Le date in DB restano UTC; questo
 * serve dove «oggi» è quello della persona: i promemoria, il riepilogo del
 * mattino, i plugin che ragionano per giorni.
 */
export function dayInRome(instant: Date = new Date()): string {
  return ROME_DAY.format(instant);
}
