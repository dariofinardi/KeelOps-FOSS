// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { COLLAPSED_COLUMN_CLASS, CollapsedColumn } from "./CollapsedColumn";

// La striscia è ciò che vede l'utente al posto di una colonna vuota: deve restare
// leggibile (nome sempre presente) e stretta, altrimenti le colonne piene non
// guadagnano lo spazio per cui esiste.
describe("CollapsedColumn", () => {
  it("mostra il nome della colonna scritto in verticale", () => {
    render(
      <div>
        <CollapsedColumn name="Preventivo inviato" color="#7c3aed" />
      </div>,
    );
    const name = screen.getByText("Preventivo inviato");
    expect(name).toBeInTheDocument();
    expect(name.className).toContain("[writing-mode:vertical-rl]");
    expect(name).toHaveStyle({ color: "rgb(124, 58, 237)" });
  });

  it("ospita la maniglia di riordino, se la kanban la passa", () => {
    render(
      <div>
        <CollapsedColumn
          name="Trattativa"
          color="#f59e0b"
          grip={<button type="button">maniglia</button>}
        />
      </div>,
    );
    expect(screen.getByRole("button", { name: "maniglia" })).toBeInTheDocument();
  });

  it("resta stretta e non lascia sfondare un nome lungo", () => {
    // overflow-hidden: un nome lungo in verticale non deve uscire dalla colonna.
    expect(COLLAPSED_COLUMN_CLASS).toContain("w-14");
    expect(COLLAPSED_COLUMN_CLASS).toContain("overflow-hidden");
  });
});
