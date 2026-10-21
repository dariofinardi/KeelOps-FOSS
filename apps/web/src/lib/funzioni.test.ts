// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { edizione } from "@/edition/rotte";
import { funzioneAccesa, moduloAcceso } from "./funzioni";

describe("funzioni dell'istanza, lato web", () => {
  it("accesa finché non compare fra le spente", () => {
    expect(funzioneAccesa({ funzioniSpente: [] }, "offerte")).toBe(true);
    expect(funzioneAccesa({ funzioniSpente: ["offerte"] }, "offerte")).toBe(false);
  });

  it("un modulo è acceso solo se l'edizione lo porta e non è spento", () => {
    expect(moduloAcceso({ funzioniSpente: [] }, "inesistente")).toBe(false);
    const presente = [...edizione.moduli][0];
    if (presente) {
      expect(moduloAcceso({ funzioniSpente: [] }, presente)).toBe(true);
      expect(moduloAcceso({ funzioniSpente: [presente] }, presente)).toBe(false);
    }
  });
});

describe("gli scope dei gruppi", () => {
  it("uno scope vale finché la sua area è accesa", async () => {
    const { scopeAcceso } = await import("./funzioni");
    expect(scopeAcceso({ funzioniSpente: [] }, "DEALS")).toBe(true);
    expect(scopeAcceso({ funzioniSpente: ["offerte"] }, "DEALS")).toBe(false);
    // lo scadenzario non si spegne
    expect(scopeAcceso({ funzioniSpente: ["offerte", "progetti"] }, "ADMIN_TASKS")).toBe(true);
    expect(scopeAcceso({ funzioniSpente: ["ticket"] }, "TICKETS")).toBe(false);
  });
});
