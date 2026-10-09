// rrule è un bundle CommonJS: sotto Node ESM i named export non vengono rilevati,
// quindi si importa il default sintetico (esModuleInterop) e si destruttura.
import rrulePkg from "rrule";
import { badRequest } from "../../lib/http-errors";

const { RRule } = rrulePkg;
type RRule = InstanceType<typeof RRule>;

// Le conversioni giorno⇄Date stanno in lib/date; qui il ri-export per i
// moduli delle ricorrenze, che le hanno sempre prese da questo file.
export { dateOnlyToUTC, toDateOnly } from "../../lib/date";

/** Costruisce la RRule da stringa (senza DTSTART) + data di inizio. */
export function buildRule(rruleString: string, dtstart: Date): RRule {
  try {
    const options = RRule.parseString(rruleString);
    if (!options.freq && options.freq !== 0) {
      throw new Error("FREQ mancante");
    }
    return new RRule({ ...options, dtstart });
  } catch {
    throw badRequest("Regola di ricorrenza (RRULE) non valida");
  }
}

/** Occorrenze nell'intervallo [from, to], estremi inclusi. */
export function occurrencesBetween(
  rruleString: string,
  dtstart: Date,
  from: Date,
  to: Date,
): Date[] {
  return buildRule(rruleString, dtstart).between(from, to, true);
}

/** Prossime `count` occorrenze a partire da `from` (inclusa). */
export function nextOccurrences(
  rruleString: string,
  dtstart: Date,
  from: Date,
  count: number,
): Date[] {
  const rule = buildRule(rruleString, dtstart);
  const result: Date[] = [];
  let cursor: Date | null = rule.after(from, true);
  while (cursor && result.length < count) {
    result.push(cursor);
    cursor = rule.after(cursor, false);
  }
  return result;
}

const WEEKDAYS_IT: Record<string, string> = {
  MO: "lunedì",
  TU: "martedì",
  WE: "mercoledì",
  TH: "giovedì",
  FR: "venerdì",
  SA: "sabato",
  SU: "domenica",
};

const ORDINALS_IT: Record<number, string> = {
  1: "primo",
  2: "secondo",
  3: "terzo",
  4: "quarto",
  [-1]: "ultimo",
};

/** Descrizione in italiano della regola (per liste e anteprima). */
export function describeRule(rruleString: string): string {
  const parts = new Map(
    rruleString
      .replace(/^RRULE:/i, "")
      .split(";")
      .filter(Boolean)
      .map((piece) => {
        const [key, value] = piece.split("=");
        return [key?.toUpperCase() ?? "", value ?? ""] as const;
      }),
  );
  const freq = parts.get("FREQ")?.toUpperCase();
  const interval = Number(parts.get("INTERVAL") ?? 1);
  const byday = parts.get("BYDAY");
  const bymonthday = parts.get("BYMONTHDAY");
  const bysetpos = parts.get("BYSETPOS");

  const weekdayName = (code: string) => WEEKDAYS_IT[code.toUpperCase()] ?? code;

  if (freq === "DAILY") {
    if (interval === 1) return "ogni giorno";
    if (interval === 15) return "ogni 15 giorni (quindicinale)";
    return `ogni ${interval} giorni`;
  }
  if (freq === "WEEKLY") {
    const days = byday ? byday.split(",").map(weekdayName).join(", ") : null;
    const base = interval === 1 ? "ogni settimana" : `ogni ${interval} settimane`;
    return days ? `${base} il ${days}` : base;
  }
  if (freq === "MONTHLY") {
    const monthBase =
      interval === 1
        ? "ogni mese"
        : interval === 2
          ? "ogni 2 mesi (bimestrale)"
          : interval === 3
            ? "ogni 3 mesi (trimestrale)"
            : interval === 6
              ? "ogni 6 mesi (semestrale)"
              : `ogni ${interval} mesi`;
    if (bymonthday === "-1") return `${monthBase}, l'ultimo giorno del mese`;
    if (bymonthday) return `${monthBase}, il giorno ${bymonthday}`;
    if (byday && bysetpos) {
      const ordinal = ORDINALS_IT[Number(bysetpos)] ?? `${bysetpos}º`;
      return `${monthBase}, il ${ordinal} ${weekdayName(byday)}`;
    }
    return monthBase;
  }
  if (freq === "YEARLY") {
    return interval === 1 ? "ogni anno" : `ogni ${interval} anni`;
  }
  return rruleString;
}
