import { config } from "../../config";

/**
 * **Di sabato e domenica le email aspettano** (richiesta del 06/09/2026). Chi
 * riceve un avviso nel weekend lo trova nella campanella subito, e nella
 * posta lunedì, in un riepilogo — a meno che non abbia chiesto le email anche
 * nel weekend. Il giorno è quello di Roma, non quello del server in UTC: alle
 * 00:30 di sabato in Italia è ancora venerdì per l'orologio del server.
 */
export function isWeekend(now: Date, timeZone = config.displayTimezone): boolean {
  const giorno = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  return giorno === "Sat" || giorno === "Sun";
}

/** L'email di questa persona può partire adesso, o aspetta il lunedì? */
export function emailPuoPartire(
  destinatario: { emailWeekend: boolean } | null | undefined,
  now = new Date(),
): boolean {
  return !isWeekend(now) || (destinatario?.emailWeekend ?? false);
}
