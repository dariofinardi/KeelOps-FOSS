// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { sign, safeEqual } from "../src/lib/signing";
import { signDoneLink, verifyDoneLink } from "../src/modules/calendar/done-link";

describe("firma condivisa", () => {
  it("confronta in byte, non in caratteri: un multibyte non fa lanciare", () => {
    // Il difetto: '43 caratteri' con una 'é' sono 44 byte, e timingSafeEqual su
    // buffer di lunghezza diversa LANCIA — la rotta pubblica rispondeva 500.
    const vero = sign("payload");
    // Un code della stessa LUNGHEZZA in caratteri ma diverso in byte.
    const finto = vero.slice(0, -1) + "é";
    expect(finto.length).toBe(vero.length); // stessi caratteri
    expect(() => safeEqual(vero, finto)).not.toThrow();
    expect(safeEqual(vero, finto)).toBe(false);
  });

  it("la stessa stringa combacia, una diversa no", () => {
    const a = sign("x");
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, sign("y"))).toBe(false);
  });
});

describe("link 'segna come fatto'", () => {
  it("verifica la firma senza esplodere su caratteri non ASCII", () => {
    const code = signDoneLink("token-feed", "task-1");
    expect(verifyDoneLink("token-feed", "task-1", code)).toBe(true);
    expect(verifyDoneLink("token-feed", "task-1", "firma-inventata")).toBe(false);
    // Il caso che prima lanciava:
    expect(() => verifyDoneLink("token-feed", "task-1", "é".repeat(43))).not.toThrow();
  });
});
