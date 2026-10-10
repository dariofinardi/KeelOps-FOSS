// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { emailPuoPartire, isWeekend } from "../src/modules/notifications/weekend";

describe("il weekend, a Roma", () => {
  it("sabato e domenica sono weekend; il confine è quello italiano, non UTC", () => {
    expect(isWeekend(new Date("2026-09-05T10:00:00Z"))).toBe(true); // sabato
    expect(isWeekend(new Date("2026-09-06T10:00:00Z"))).toBe(true); // domenica
    expect(isWeekend(new Date("2026-09-07T05:00:00Z"))).toBe(false); // lunedì 07:00 a Roma
    // venerdì 23:30 UTC = sabato 01:30 a Roma
    expect(isWeekend(new Date("2026-09-04T23:30:00Z"))).toBe(true);
    // domenica 22:30 UTC = lunedì 00:30 a Roma
    expect(isWeekend(new Date("2026-09-06T22:30:00Z"))).toBe(false);
  });

  it("nel weekend l'email parte solo per chi l'ha chiesta", () => {
    const sabato = new Date("2026-09-05T10:00:00Z");
    expect(emailPuoPartire({ emailWeekend: false }, sabato)).toBe(false);
    expect(emailPuoPartire({ emailWeekend: true }, sabato)).toBe(true);
    expect(emailPuoPartire(null, sabato)).toBe(false);
    expect(emailPuoPartire({ emailWeekend: false }, new Date("2026-09-07T10:00:00Z"))).toBe(true);
  });
});
