// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Label } from "./label";

describe("Label con la scala d'importanza", () => {
  it("un campo necessario porta il pallino, con la spiegazione nel tooltip", () => {
    render(<Label importance="required">Titolo</Label>);
    expect(screen.getByLabelText("Campo necessario")).toBeInTheDocument();
  });

  it("un campo consigliato si distingue dal necessario", () => {
    render(<Label importance="recommended">Scadenza</Label>);
    expect(screen.getByLabelText(/Consigliato/)).toBeInTheDocument();
  });

  it("un campo opzionale resta com'era: nessun segno", () => {
    // La scala è a tre gradini ma il terzo è il silenzio: segnare tutto
    // equivarrebbe a non segnare niente.
    const { container } = render(<Label>Tag</Label>);
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });
});
