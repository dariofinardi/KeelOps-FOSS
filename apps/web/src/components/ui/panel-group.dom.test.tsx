// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PanelGroup } from "./panel-group";

/**
 * Il gruppo di un pannello. Quel che conta è che **il tono arrivi al filo**: il
 * colore dice di cosa parla la sezione ed è lo stesso di `SectionIcon`, quindi
 * un filo grigio dove l'icona è rosa insegnerebbe una cosa falsa.
 */
describe("il gruppo di un pannello", () => {
  it("il filo a sinistra porta il tono della sezione", () => {
    const { container } = render(
      <PanelGroup tone="rose" title="Persone">
        <p>contenuto</p>
      </PanelGroup>,
    );
    const sezione = container.querySelector("section")!;
    expect(sezione.className).toContain("border-l-rose-400");
    expect(sezione.className).toContain("border-l-2");
  });

  it("toni diversi danno fili diversi, presi dallo stesso registro", () => {
    const { container } = render(
      <>
        <PanelGroup tone="sky" title="Stato e tempo">
          <p>a</p>
        </PanelGroup>
        <PanelGroup tone="emerald" title="Contenuto">
          <p>b</p>
        </PanelGroup>
      </>,
    );
    const fili = [...container.querySelectorAll("section")].map((s) => s.className);
    expect(fili[0]).toContain("border-l-sky-400");
    expect(fili[1]).toContain("border-l-emerald-400");
  });

  it("l'etichetta è un titolo vero, non un paragrafo in maiuscolo", () => {
    // Serve a chi naviga con lo screen reader: dodici sezioni senza gerarchia
    // sono un muro.
    render(
      <PanelGroup tone="slate" title="Contesto" meta="dove vive">
        <p>x</p>
      </PanelGroup>,
    );
    expect(screen.getByRole("heading", { name: "Contesto" })).toBeInTheDocument();
    expect(screen.getByText("dove vive")).toBeInTheDocument();
  });
});
