// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { buildIcs, type CalendarEntry } from "../src/modules/calendar/ics";

const entry = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: "t1",
  title: "Consegna beta",
  date: new Date("2026-08-14T00:00:00Z"),
  context: ["Progetto: Atlante", "Stato: Da fare"],
  url: "https://crm.example.com/scadenzario?task=t1",
  categories: ["Sviluppo", "Atlante"],
  updatedAt: new Date("2026-08-06T10:00:00Z"),
  ...over,
});

/**
 * Il file come lo legge un client: le righe spezzate a 75 ottetti si ricuciono
 * prima di guardarne il contenuto (lo standard le chiama "folding").
 */
const unfold = (ics: string) => ics.replaceAll("\r\n ", "");

const feed = (over: Partial<CalendarEntry> = {}) =>
  unfold(buildIcs({ name: "KeelOps — Le mie scadenze", entries: [entry(over)] }));

describe("feed iCalendar", () => {
  it("un giorno intero, con la fine al giorno dopo", () => {
    // In iCalendar la fine di un evento è esclusiva: senza il +1 il task
    // sparisce dal giorno in cui scade.
    const ics = feed();
    expect(ics).toContain("DTSTART;VALUE=DATE:20260814");
    expect(ics).toContain("DTEND;VALUE=DATE:20260815");
  });

  /**
   * **Con l'orario è una mezz'ora, non un giorno.** Una telefonata alle 9:30
   * in agenda vuole stare alle 9:30, per mezz'ora, e occupare quello spazio
   * (26/08/2026). L'orario è ora italiana e il feed lo pubblica in UTC, con
   * l'offset di quel giorno: agosto è CEST (+2), gennaio CET (+1).
   */
  it("con l'orario diventa un evento di mezz'ora, in UTC, che occupa l'agenda", () => {
    const ics = feed({ time: "09:30" }); // 14 agosto: ora legale, +2
    expect(ics).toContain("DTSTART:20260814T073000Z");
    expect(ics).toContain("DTEND:20260814T080000Z");
    expect(ics).toContain("TRANSP:OPAQUE");
    expect(ics).not.toContain("VALUE=DATE");
  });

  it("d'inverno l'offset è quello giusto: CET, un'ora sola", () => {
    const ics = feed({ date: new Date("2026-01-14T00:00:00Z"), time: "09:30" });
    expect(ics).toContain("DTSTART:20260114T083000Z");
    expect(ics).toContain("DTEND:20260114T090000Z");
  });

  it("senza orario resta un giorno intero, trasparente", () => {
    const ics = feed({ time: null });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260814");
    expect(ics).toContain("TRANSP:TRANSPARENT");
  });

  it("l'evento si aggiorna invece di duplicarsi", () => {
    // UID stabile + SEQUENCE crescente: senza, ogni rilettura del feed lascia
    // la vecchia copia accanto alla nuova.
    const ics = feed();
    expect(ics).toContain("UID:t1@keelops");
    expect(ics).toContain("LAST-MODIFIED:20260806T100000Z");
    expect(ics).toContain(`SEQUENCE:${Math.floor(Date.UTC(2026, 7, 6, 10) / 1000)}`);
  });

  it("non occupa la giornata di chi lo guarda", () => {
    // Una scadenza non è un impegno: chi controlla la disponibilità di un
    // collega non deve vederlo occupato perché ha una fattura da emettere.
    expect(feed()).toContain("TRANSP:TRANSPARENT");
  });

  it("porta i due indirizzi: aprire e segnare fatto", () => {
    const ics = feed({ doneUrl: "https://crm.example.com/fatto/t1?t=abc" });
    expect(ics).toContain("URL:https://crm.example.com/scadenzario?task=t1");
    expect(ics).toContain("Apri in KeelOps: https://crm.example.com/scadenzario?task=t1");
    expect(ics).toContain("Segna come fatto: https://crm.example.com/fatto/t1?t=abc");
  });

  it("senza il link di chiusura la descrizione non lo nomina", () => {
    expect(feed()).not.toContain("Segna come fatto");
  });

  it("un task chiuso resta in agenda, ma si vede che è chiuso", () => {
    const ics = feed({ closed: true });
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SUMMARY:✓ Consegna beta");
  });

  it("i caratteri speciali non rompono il file", () => {
    // Virgole e punti e virgola separano i valori in iCalendar: un titolo che
    // ne contiene sposterebbe i campi successivi.
    const ics = feed({ title: "Fatturare 1.000, IVA; saldo\ndicembre" });
    expect(ics).toContain("SUMMARY:Fatturare 1.000\\, IVA\\; saldo\\ndicembre");
  });

  it("le righe lunghe si spezzano come vuole lo standard", () => {
    // Qui si guarda il file NON ricucito: è quello che viaggia.
    const ics = buildIcs({ name: "KeelOps", entries: [entry({ title: "T".repeat(200) })] });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("dice al client ogni quanto rileggere, e come si chiama", () => {
    const ics = unfold(buildIcs({ name: "KeelOps — Progetto Atlante", entries: [] }));
    expect(ics).toContain("X-WR-CALNAME:KeelOps — Progetto Atlante");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT15M");
    expect(ics).toContain("X-PUBLISHED-TTL:PT15M");
  });

  it("un calendario vuoto è un calendario valido", () => {
    const ics = buildIcs({ name: "KeelOps", entries: [] });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
