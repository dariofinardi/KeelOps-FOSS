// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  dateOnlyToUTC,
  describeRule,
  nextOccurrences,
  occurrencesBetween,
  toDateOnly,
} from "../src/modules/recurrence/rrule";

function occurrences(rrule: string, dtstart: string, from: string, to: string): string[] {
  return occurrencesBetween(
    rrule,
    dateOnlyToUTC(dtstart),
    dateOnlyToUTC(from),
    dateOnlyToUTC(to),
  ).map((giorno) => toDateOnly(giorno));
}

describe("rrule — fine mese", () => {
  it("ultimo giorno del mese gestisce 28/29/30/31", () => {
    const result = occurrences(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
      "2026-01-01",
      "2026-01-01",
      "2026-05-01",
    );
    expect(result).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("febbraio bisestile cade il 29", () => {
    const result = occurrences(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
      "2028-01-01",
      "2028-02-01",
      "2028-03-01",
    );
    expect(result).toEqual(["2028-02-29"]);
  });

  it("il giorno 31 salta i mesi corti", () => {
    const result = occurrences(
      "FREQ=MONTHLY;BYMONTHDAY=31",
      "2026-01-01",
      "2026-01-01",
      "2026-06-01",
    );
    expect(result).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });
});

describe("rrule — secondo martedì del mese", () => {
  it("calcola il secondo martedì", () => {
    const result = occurrences(
      "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2",
      "2026-07-01",
      "2026-07-01",
      "2026-09-30",
    );
    expect(result).toEqual(["2026-07-14", "2026-08-11", "2026-09-08"]);
  });

  it("ultimo venerdì del mese", () => {
    const result = occurrences(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1",
      "2026-07-01",
      "2026-07-01",
      "2026-08-31",
    );
    expect(result).toEqual(["2026-07-31", "2026-08-28"]);
  });
});

describe("rrule — quindicinale a cavallo d'anno", () => {
  it("prosegue correttamente da dicembre a gennaio", () => {
    const result = occurrences("FREQ=DAILY;INTERVAL=15", "2026-12-20", "2026-12-01", "2027-02-01");
    expect(result).toEqual(["2026-12-20", "2027-01-04", "2027-01-19"]);
  });
});

describe("rrule — bimestrale", () => {
  it("ogni 2 mesi il giorno 15", () => {
    const result = occurrences(
      "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15",
      "2026-01-15",
      "2026-01-01",
      "2026-07-31",
    );
    expect(result).toEqual(["2026-01-15", "2026-03-15", "2026-05-15", "2026-07-15"]);
  });
});

describe("rrule — trimestrale e semestrale", () => {
  it("ogni 3 mesi il giorno 20 (scadenze IVA)", () => {
    const result = occurrences(
      "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=20",
      "2026-01-20",
      "2026-01-01",
      "2026-12-31",
    );
    expect(result).toEqual(["2026-01-20", "2026-04-20", "2026-07-20", "2026-10-20"]);
  });

  it("ogni 6 mesi l'ultimo giorno del mese, a cavallo d'anno", () => {
    const result = occurrences(
      "FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=-1",
      "2026-06-30",
      "2026-01-01",
      "2027-07-31",
    );
    expect(result).toEqual(["2026-06-30", "2026-12-31", "2027-06-30"]);
  });

  it("ogni 3 mesi il secondo martedì", () => {
    const result = occurrences(
      "FREQ=MONTHLY;INTERVAL=3;BYDAY=TU;BYSETPOS=2",
      "2026-01-01",
      "2026-01-01",
      "2026-10-31",
    );
    expect(result).toEqual(["2026-01-13", "2026-04-14", "2026-07-14", "2026-10-13"]);
  });
});

describe("nextOccurrences e descrizioni", () => {
  it("restituisce le prossime N occorrenze", () => {
    const result = nextOccurrences(
      "FREQ=MONTHLY;BYMONTHDAY=15",
      dateOnlyToUTC("2026-01-15"),
      dateOnlyToUTC("2026-07-20"),
      3,
    ).map((giorno) => toDateOnly(giorno));
    expect(result).toEqual(["2026-08-15", "2026-09-15", "2026-10-15"]);
  });

  it("descrive le regole in italiano", () => {
    expect(describeRule("FREQ=DAILY")).toBe("ogni giorno");
    expect(describeRule("FREQ=DAILY;INTERVAL=15")).toBe("ogni 15 giorni (quindicinale)");
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO")).toBe("ogni settimana il lunedì");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=15")).toBe("ogni mese, il giorno 15");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=-1")).toBe("ogni mese, l'ultimo giorno del mese");
    expect(describeRule("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2")).toBe("ogni mese, il secondo martedì");
    expect(describeRule("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15")).toBe(
      "ogni 2 mesi (bimestrale), il giorno 15",
    );
    expect(describeRule("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=20")).toBe(
      "ogni 3 mesi (trimestrale), il giorno 20",
    );
    expect(describeRule("FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=-1")).toBe(
      "ogni 6 mesi (semestrale), l'ultimo giorno del mese",
    );
    expect(describeRule("FREQ=YEARLY")).toBe("ogni anno");
  });
});
