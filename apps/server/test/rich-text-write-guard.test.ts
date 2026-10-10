// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { sanitizeWriteData } from "../src/modules/rich-text/write-guard";

describe("ripulitura sulla strada del database", () => {
  it("ripulisce le descrizioni, qualunque rotta le abbia scritte", () => {
    const data = { title: "Consegna", description: "<p>Ciao</p><script>alert(1)</script>" };
    expect(sanitizeWriteData("Task", data)).toEqual({
      title: "Consegna",
      description: "<p>Ciao</p>",
    });
  });

  it("vale anche per la forma { set } e per le scritture multiple", () => {
    expect(
      sanitizeWriteData("Project", { description: { set: '<p onclick="x()">Ciao</p>' } }),
    ).toEqual({ description: { set: "<p>Ciao</p>" } });
    expect(
      sanitizeWriteData("RecurrenceTemplate", [{ description: "<iframe></iframe>Canone" }]),
    ).toEqual([{ description: "Canone" }]);
  });

  it("non tocca i campi che non sono testo descrittivo", () => {
    // Il titolo è testo semplice e tale resta: ripulirlo lo riscriverebbe.
    const data = { title: "Confronto x < y", name: "<b>", description: null };
    expect(sanitizeWriteData("Task", data)).toBe(data);
  });

  it("non tocca i modelli che non hanno testo arricchito", () => {
    const data = { description: "<script>alert(1)</script>" };
    // Un modello fuori elenco passa intatto: è un elenco, non un'euristica.
    expect(sanitizeWriteData("Comment", data)).toBe(data);
  });
});
