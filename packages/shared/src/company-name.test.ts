// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { chiaveNomeAzienda, stessaAzienda } from "./company-name";

describe("quando due nomi sono la stessa azienda", () => {
  it("jugaad, Jugaad e Jugaad srl sono una azienda sola", () => {
    for (const nome of ["jugaad", "Jugaad", "JUGAAD", "Jugaad srl", "Jugaad S.r.l.", "Jugaad s.r.l", "  Jugaad   SRL "]) {
      expect(chiaveNomeAzienda(nome), nome).toBe("jugaad");
    }
  });

  it("le forme societarie in coda non contano, anche di più parole", () => {
    expect(stessaAzienda("Integro", "Integro SRL")).toBe(true);
    expect(stessaAzienda("Rossi & C. snc", "Rossi")).toBe(true);
    expect(stessaAzienda("Bianchi e C. s.a.s.", "bianchi")).toBe(true);
    expect(stessaAzienda("Cantina Sociale Soc. Coop.", "Cantina Sociale")).toBe(true);
    expect(stessaAzienda("Acme S.p.A.", "ACME spa")).toBe(true);
    expect(stessaAzienda("Müller GmbH", "Muller")).toBe(true);
    expect(stessaAzienda("Rossi Software S.r.l.s.", "Rossi Software")).toBe(true);
  });

  it("accenti e punteggiatura non contano", () => {
    expect(stessaAzienda("Città-Verde", "citta verde")).toBe(true);
    expect(stessaAzienda("L'Officina", "L Officina")).toBe(true);
  });

  it("aziende diverse restano diverse", () => {
    expect(stessaAzienda("Studio Rossi Associati", "Rossi")).toBe(false);
    expect(stessaAzienda("Jugaad", "Jugaad Digital")).toBe(false);
    expect(stessaAzienda("SPA Terme", "Terme")).toBe(false);
  });

  it("una sigla da sola resta sé stessa: una chiave vuota renderebbe tutto uguale", () => {
    expect(chiaveNomeAzienda("SRL")).toBe("srl");
    expect(chiaveNomeAzienda("S.p.A.")).toBe("spa");
  });
});
