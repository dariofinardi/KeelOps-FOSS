// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, onForbidden } from "./api";

/**
 * **Un 403 dice che i permessi sono cambiati sotto i piedi.**
 *
 * Succede quando l'elevazione ad amministratore finisce mentre la pagina è
 * aperta — scaduta, o chiusa da un'altra scheda: il server smette di concedere
 * ciò che l'interfaccia sta ancora offrendo, e senza questo aggancio l'utente
 * vede solo comandi che non fanno niente (26/08/2026, la pagina Utenti vuota
 * con tre 403 in console).
 */
function rispondi(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

afterEach(() => {
  onForbidden(null);
  vi.unstubAllGlobals();
});

describe("il client avvisa quando il server rifiuta", () => {
  it("un 403 sveglia chi si è registrato", async () => {
    const avvisato = vi.fn();
    onForbidden(avvisato);
    vi.stubGlobal("fetch", rispondi(403, { message: "Riservato agli amministratori" }));
    await expect(api("/api/users")).rejects.toThrow("Riservato agli amministratori");
    expect(avvisato).toHaveBeenCalledOnce();
  });

  it("il 403 dell'utente stesso non lo sveglia: sarebbe un giro in tondo", async () => {
    const avvisato = vi.fn();
    onForbidden(avvisato);
    vi.stubGlobal("fetch", rispondi(403, { message: "no" }));
    await expect(api("/api/auth/me")).rejects.toThrow();
    expect(avvisato).not.toHaveBeenCalled();
  });

  it("gli altri errori non lo riguardano", async () => {
    const avvisato = vi.fn();
    onForbidden(avvisato);
    vi.stubGlobal("fetch", rispondi(404, { message: "non trovato" }));
    await expect(api("/api/users")).rejects.toThrow("non trovato");
    vi.stubGlobal("fetch", rispondi(401, { message: "fuori" }));
    await expect(api("/api/users")).rejects.toThrow("fuori");
    expect(avvisato).not.toHaveBeenCalled();
  });

  it("una risposta buona non sveglia nessuno", async () => {
    const avvisato = vi.fn();
    onForbidden(avvisato);
    vi.stubGlobal("fetch", rispondi(200, { ok: true }));
    await expect(api("/api/users")).resolves.toEqual({ ok: true });
    expect(avvisato).not.toHaveBeenCalled();
  });

  it("chi si sgancia non viene più svegliato", async () => {
    const avvisato = vi.fn();
    onForbidden(avvisato);
    onForbidden(null);
    vi.stubGlobal("fetch", rispondi(403, { message: "no" }));
    await expect(api("/api/users")).rejects.toThrow();
    expect(avvisato).not.toHaveBeenCalled();
  });
});
