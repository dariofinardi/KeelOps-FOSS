/**
 * Il feed iCalendar delle bacheche.
 *
 * Serve a farsi vedere il proprio lavoro dentro Google Calendar, Outlook/M365 o
 * il telefono. È **in sola lettura, per protocollo**: un calendario sottoscritto
 * per URL è una sorgente, e non esiste modo perché il client rimandi indietro
 * una modifica. Quello che si può riavere — "fatto" — passa da un link dentro
 * l'evento, non dal calendario.
 *
 * Tre scelte che decidono se il feed funziona davvero:
 *
 * 1. **Solo VEVENT, mai VTODO.** Google Calendar e Outlook i VTODO li ignorano
 *    in un calendario sottoscritto: pubblicare così i task senza scadenza vuol
 *    dire spedirli e sperare. Chi non ha una data resta fuori — un calendario
 *    mostra ciò che accade in un giorno.
 * 2. **UID stabile e `LAST-MODIFIED`/`SEQUENCE`.** È così che un evento
 *    *cambia* invece di duplicarsi: senza, ogni rilettura del feed lascia in
 *    agenda la vecchia copia accanto alla nuova.
 * 3. **`TRANSP:TRANSPARENT`.** Una scadenza non occupa la giornata: chi guarda
 *    la disponibilità di un collega non lo deve vedere occupato tutto il giorno
 *    perché ha una fattura da emettere.
 */

export interface CalendarEntry {
  /** Id del record: diventa la parte stabile dell'UID. */
  id: string;
  title: string;
  /** Giorno dell'evento. Chi non ce l'ha non entra nel feed. */
  date: Date;
  /**
   * Orario "HH:MM" in ora italiana, se il task ce l'ha (una telefonata, un
   * appuntamento). Con l'orario l'evento non è più un giorno intero: è una
   * mezz'ora, dalle HH:MM, e occupa l'agenda (26/08/2026).
   */
  time?: string | null;
  /** Righe di contesto (progetto, cliente, stato), già pronte da leggere. */
  context: string[];
  /** Indirizzo del record nell'applicazione. */
  url: string | null;
  /** Indirizzo che apre la conferma di chiusura, se il feed lo prevede. */
  doneUrl?: string | null;
  /** Area/progetto: i client li usano per colorare e filtrare. */
  categories: string[];
  /** Ultima modifica del record: fa aggiornare l'evento già in agenda. */
  updatedAt: Date;
  /** Task chiuso: resta in agenda barrato invece di sparire senza spiegazione. */
  closed?: boolean;
}

export interface CalendarFeedOptions {
  /** Nome che il client mostra all'utente ("KeelOps — Le mie scadenze"). */
  name: string;
  entries: CalendarEntry[];
  now?: Date;
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

/** Folding RFC 5545: righe max 75 ottetti, continuazione con spazio. */
function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > 74) {
      parts.push(current);
      current = " " + char; // continuazione
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join("\r\n");
}

const dateValue = (date: Date): string => date.toISOString().slice(0, 10).replaceAll("-", "");
const stampValue = (date: Date): string =>
  date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

/**
 * Durata standard di un evento con orario: mezz'ora. Il task non sa quanto
 * durerà una telefonata; una mezz'ora in agenda è il posto giusto per trovarla.
 */
export const TIMED_EVENT_MINUTES = 30;

/**
 * L'istante UTC di un orario **in ora italiana** su un dato giorno.
 *
 * Gli orari dei task sono "ora italiana" per convenzione di prodotto e il
 * feed li pubblica in UTC (`…Z`): così ogni client li mostra giusti senza un
 * VTIMEZONE, che Outlook pretende e Google ignora. L'offset si legge da Intl
 * per QUEL giorno — CET d'inverno, CEST d'estate — non da una costante.
 */
const ROME_WALL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
export function romeTimeToUtc(day: Date, time: string): Date {
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
  const parts = Object.fromEntries(
    ROME_WALL.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
  );
  return new Date(guess - (wall - guess));
}

/** Il giorno dopo: in iCalendar la fine di un evento di un giorno è esclusiva. */
function nextDay(date: Date): Date {
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

/**
 * Il corpo dell'evento: contesto, poi i due indirizzi. Sono righe, non prosa:
 * su un telefono la descrizione si legge in tre centimetri.
 */
function describe(entry: CalendarEntry): string {
  return [
    ...entry.context,
    ...(entry.url ? ["", `Apri in KeelOps: ${entry.url}`] : []),
    ...(entry.doneUrl ? [`Segna come fatto: ${entry.doneUrl}`] : []),
  ].join("\n");
}

export function buildIcs({ name, entries, now = new Date() }: CalendarFeedOptions): string {
  const stamp = stampValue(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KeelOps//Calendario//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Europe/Rome",
    // Ogni quanto rileggere. Apple lo rispetta; Google e Outlook decidono da
    // sé (ore, non minuti) e non c'è modo di convincerli: il calendario resta
    // una vista in ritardo, non un posto dove lavorare.
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  for (const entry of entries) {
    const description = describe(entry);
    // Con l'orario: mezz'ora precisa, in UTC. Senza: il giorno intero.
    const start = entry.time ? romeTimeToUtc(entry.date, entry.time) : null;
    const when = start
      ? [
          `DTSTART:${stampValue(start)}`,
          `DTEND:${stampValue(new Date(start.getTime() + TIMED_EVENT_MINUTES * 60_000))}`,
        ]
      : [
          `DTSTART;VALUE=DATE:${dateValue(entry.date)}`,
          `DTEND;VALUE=DATE:${dateValue(nextDay(entry.date))}`,
        ];
    lines.push(
      "BEGIN:VEVENT",
      `UID:${entry.id}@keelops`,
      `DTSTAMP:${stamp}`,
      ...when,
      `SUMMARY:${escapeText(entry.closed ? `✓ ${entry.title}` : entry.title)}`,
      ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
      ...(entry.url ? [`URL:${entry.url}`] : []),
      ...(entry.categories.length
        ? [`CATEGORIES:${entry.categories.map(escapeText).join(",")}`]
        : []),
      `LAST-MODIFIED:${stampValue(entry.updatedAt)}`,
      // Un intero che cresce a ogni modifica: i client aggiornano l'evento solo
      // se il numero è salito. I secondi dell'ultima modifica bastano e avanzano.
      `SEQUENCE:${Math.floor(entry.updatedAt.getTime() / 1000)}`,
      `STATUS:${entry.closed ? "CANCELLED" : "CONFIRMED"}`,
      // Una scadenza non occupa la giornata; una telefonata la sua mezz'ora sì.
      `TRANSP:${start ? "OPAQUE" : "TRANSPARENT"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
