// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { generateTempPassword } from "./temp-password";

describe("generateTempPassword", () => {
  it("ha la forma che si può dettare: tre gruppi di quattro, minuscoli e cifre", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateTempPassword()).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    }
  });

  it("non contiene i caratteri che si confondono", () => {
    const generated = Array.from({ length: 200 }, () => generateTempPassword()).join("");
    for (const ambiguous of ["0", "1", "2", "5", "7", "i", "l", "o", "s", "u", "v", "z"]) {
      expect(generated).not.toContain(ambiguous);
    }
  });

  it("è lunga abbastanza per il minimo richiesto dalla validazione (8 caratteri)", () => {
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(8);
  });

  it("non ripete la stessa password", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateTempPassword()));
    expect(seen.size).toBe(200);
  });

  it("scarta i byte oltre la soglia invece di piegarli sui primi simboli", () => {
    // 250 e 255 sono da scartare (soglia 240): se finissero nel resto darebbero
    // due caratteri qualsiasi, e il primo gruppo non sarebbe tutto "aaaa".
    const bytes = [250, 255, 0, 0, 0, 0, 250, 250, 250, 250, 250, 250];
    let next = 0;
    const random = (length: number) =>
      Uint8Array.from({ length }, () => bytes[next++ % bytes.length]!);
    expect(generateTempPassword(random).slice(0, 4)).toBe("aaaa");
  });
});
