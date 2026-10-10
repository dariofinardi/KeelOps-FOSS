// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DemoAnalytics } from "./DemoAnalytics";
import { normalizzaPercorso } from "@/lib/analytics";
import { CONSENSO_COOKIE, VERSIONE_INFORMATIVA, scriviSceltaCookie } from "@kancrm/shared";

/**
 * **Google Analytics nella demo** (18/09/2026): niente senza configurazione,
 * niente prima di un sì; dopo il sì le pagine partono senza identificativi.
 */
let providers: unknown = null;
vi.mock("@/features/auth/useAuth", () => ({
  useProviders: () => ({ data: providers }),
  useMe: () => ({ data: { role: "MEMBER" } }),
  useInternalLists: () => true,
}));

const script = () =>
  document.head.querySelector(
    'script[src*="googletagmanager.com/gtag/js"]',
  ) as HTMLScriptElement | null;

const mostra = (percorso = "/progetti/cm1a2b3c4d5e6f7g8h9i0j1k2") =>
  render(
    <MemoryRouter initialEntries={[percorso]}>
      <DemoAnalytics />
    </MemoryRouter>,
  );

describe("percorsi senza dati", () => {
  it("gli identificativi diventano :id, la query sparisce", () => {
    expect(normalizzaPercorso("/progetti/cm1a2b3c4d5e6f7g8h9i0j1k2")).toBe("/progetti/:id");
    expect(normalizzaPercorso("/documento/0b8e6f5a-1c2d-4e3f-9a8b-7c6d5e4f3a2b")).toBe(
      "/documento/:id",
    );
    expect(normalizzaPercorso("/offerte?deal=cmx123&q=Acme")).toBe("/offerte");
    expect(normalizzaPercorso("/timesheet/2026/37")).toBe("/timesheet/:id/:id");
    expect(normalizzaPercorso("/")).toBe("/");
    expect(normalizzaPercorso("/progetti/")).toBe("/progetti");
  });
});

describe("il consenso", () => {
  beforeEach(() => {
    document.cookie = `${CONSENSO_COOKIE}=; Max-Age=0; Path=/`;
    script()?.remove();
    delete window.gtag;
    window.dataLayer = [];
  });

  it("fuori da una demo con GA non chiede e non carica niente", () => {
    providers = { demo: null };
    const { container } = mostra();
    expect(container).toBeEmptyDOMElement();
    expect(script()).toBeNull();
  });

  it("nella demo chiede; finché non si risponde, gtag non si scarica", () => {
    providers = { demo: { analytics: { measurementId: "G-PROVA123" } } };
    mostra();
    expect(screen.getByRole("dialog", { name: "Statistiche d'uso" })).toBeInTheDocument();
    expect(script()).toBeNull();
  });

  it("«No»: niente script, e la domanda non torna", () => {
    providers = { demo: { analytics: { measurementId: "G-PROVA123" } } };
    mostra();
    fireEvent.click(screen.getByRole("button", { name: "No, grazie" }));
    expect(script()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(decodeURIComponent(document.cookie)).toContain('"s":false');
  });

  it("una scelta fatta sul sito vale anche qui: niente domanda, e gtag parte", () => {
    providers = { demo: { analytics: { measurementId: "G-PROVA123" } } };
    document.cookie = `${CONSENSO_COOKIE}=${scriviSceltaCookie({
      id: "c-dal-sito",
      v: VERSIONE_INFORMATIVA,
      s: true,
      m: false,
      t: "2026-09-18T08:00:00.000Z",
    })}; Path=/`;
    mostra();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(script()?.src).toContain("id=G-PROVA123");
  });

  it("una scelta su un'informativa più vecchia non vale: si richiede", () => {
    providers = { demo: { analytics: { measurementId: "G-PROVA123" } } };
    document.cookie = `${CONSENSO_COOKIE}=${scriviSceltaCookie({
      id: "c-vecchia",
      v: "2026-09-12",
      s: true,
      m: false,
      t: "2026-09-12T08:00:00.000Z",
    })}; Path=/`;
    mostra();
    expect(screen.getByRole("dialog", { name: "Statistiche d'uso" })).toBeInTheDocument();
    expect(script()).toBeNull();
  });

  it("«Sì»: gtag si carica e la pagina parte senza l'id del progetto", () => {
    providers = { demo: { analytics: { measurementId: "G-PROVA123" } } };
    mostra();
    fireEvent.click(screen.getByRole("button", { name: "Sì, va bene" }));
    expect(script()?.src).toContain("id=G-PROVA123");
    const eventi = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
    const vista = eventi.find((e) => e[0] === "event" && e[1] === "page_view");
    expect(vista?.[2]).toMatchObject({ page_path: "/progetti/:id", page_title: "/progetti/:id" });
    expect(JSON.stringify(eventi)).not.toContain("cm1a2b3c4d5e6f7g8h9i0j1k2");
    expect(eventi.some((e) => e[0] === "set" && JSON.stringify(e[2]).includes("MEMBER"))).toBe(
      true,
    );
  });
});
