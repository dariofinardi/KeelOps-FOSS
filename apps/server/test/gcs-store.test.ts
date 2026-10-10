// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { dellIstanza, fileNonTrovato, gcsStore } from "../src/modules/attachments/gcs-store";

/**
 * Prima qualunque errore del bucket diventava «il file non c'è», e chi leggeva
 * si sentiva dire che un contratto al suo posto era perduto — senza nemmeno una
 * riga nei log (04/09/2026).
 */
describe("«non c'è» contro «non ho potuto chiedere»", () => {
  it("solo il 404 vuol dire che il file non c'è", () => {
    expect(fileNonTrovato({ code: 404 })).toBe(true);
  });

  it("tutto il resto è un guasto, e come tale deve risalire", () => {
    expect(fileNonTrovato({ code: 403 }), "credenziali sbagliate").toBe(false);
    expect(fileNonTrovato({ code: 503 }), "servizio non disponibile").toBe(false);
    expect(fileNonTrovato(new Error("socket hang up")), "rete caduta").toBe(false);
    expect(fileNonTrovato(null)).toBe(false);
    expect(fileNonTrovato(undefined)).toBe(false);
  });
});

/**
 * Più istanze nello stesso bucket (02/10/2026): Jugaad alla radice, le altre in
 * `istanze/<nome>`. Chi sta alla radice non deve vedere le cartelle degli altri —
 * la sua pulizia notturna degli orfani le cancellerebbe.
 */
describe("ogni istanza vede solo la sua parte del bucket", () => {
  it("alla radice: tutto tranne istanze/", () => {
    expect(dellIstanza("ab/cd/contratto.pdf", "")).toBe(true);
    expect(dellIstanza("backup/2026-10-02.sql.gz", "")).toBe(true);
    expect(dellIstanza("istanze/studiorossi/ab/fattura.pdf", "")).toBe(false);
    expect(dellIstanza("istanze/studiorossi/backup/x.sql.gz", "")).toBe(false);
  });

  it("in una sottocartella: solo la sua, non quella di un'istanza dal nome simile", () => {
    const studio = "istanze/studiorossi";
    expect(dellIstanza("istanze/studiorossi/ab/fattura.pdf", studio)).toBe(true);
    expect(dellIstanza("istanze/studiorossi2/ab/fattura.pdf", studio)).toBe(false);
    expect(dellIstanza("ab/cd/contratto.pdf", studio)).toBe(false);
  });

  it("alla radice non si scrive né si cancella nella cartella di un altro", async () => {
    const store = gcsStore({ bucket: "keelops", prefix: "", projectId: null });
    await expect(store.remove("istanze/studiorossi/ab/fattura.pdf")).rejects.toThrow(
      /altra istanza/,
    );
  });
});
