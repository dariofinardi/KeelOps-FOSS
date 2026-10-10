// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

export interface IcalItem {
  title: string;
  description: string | null;
  date: Date | null;
  /**
   * Fine dell'evento (`DTEND`), quando c'è. Serve alle ferie su più giorni: in
   * iCalendar il DTEND di un evento tutto-il-giorno è **esclusivo** — «dal 10
   * al 12» si scrive 10→13 — e chi legge deve saperlo.
   */
  end: Date | null;
  /** Evento tutto-il-giorno (`DTSTART;VALUE=DATE`), senza orario. */
  allDay: boolean;
  /**
   * L'identità dell'evento (`UID`), stabile attraverso le modifiche: è quella
   * che permette di dire «questo evento è CAMBIATO» invece di vedere una
   * cancellazione più un inserimento. `null` se il calendario non la dà.
   */
  uid: string | null;
}

function unescapeText(value: string): string {
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\N", "\n")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\");
}

function parseIcalDate(value: string): Date | null {
  // 20260915 oppure 20260915T093000(Z): interessa solo la parte data.
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * Parser iCalendar minimale (RFC 5545): estrae VEVENT e VTODO con titolo,
 * descrizione e data (DTSTART, o DUE per i VTODO).
 */
export function parseIcs(text: string): IcalItem[] {
  // Unfolding: le righe continuate iniziano con spazio o tab.
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");

  const items: IcalItem[] = [];
  let current: {
    title?: string;
    description?: string;
    dtstart?: string;
    dtend?: string;
    due?: string;
    allDay?: boolean;
    uid?: string;
  } | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT" || line === "BEGIN:VTODO") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT" || line === "END:VTODO") {
      if (current?.title) {
        items.push({
          title: unescapeText(current.title).slice(0, 200),
          description: current.description ? unescapeText(current.description) : null,
          date: parseIcalDate(current.due ?? current.dtstart ?? ""),
          end: current.dtend ? parseIcalDate(current.dtend) : null,
          allDay: current.allDay === true,
          uid: current.uid ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(";")[0]!.toUpperCase();
    const value = line.slice(colon + 1);
    if (key === "SUMMARY") current.title = value;
    else if (key === "UID") current.uid = value.trim();
    else if (key === "DTEND") current.dtend = value;
    else if (key === "DESCRIPTION") current.description = value;
    else if (key === "DTSTART") {
      current.dtstart = value;
      // `DTSTART;VALUE=DATE` = tutto il giorno. La distinzione conta: un evento
      // con l'orario può durare mezz'ora e voler dire una giornata intera di
      // ferie (calendario aziendale, 21/08/2026), quindi la durata non si usa.
      current.allDay = /;VALUE=DATE(?![-A-Z])/i.test(line.slice(0, colon));
    }
    else if (key === "DUE") current.due = value;
  }
  return items;
}
