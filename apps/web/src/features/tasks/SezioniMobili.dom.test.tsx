// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SezioniMobili, useSezioneMobile, type VoceSezione } from "./SezioniMobili";

/**
 * Sul telefono una sezione per volta (25/10/2026): la barra in basso sceglie,
 * e le altre si nascondono **solo sotto `sm`** (`max-sm:hidden`): sopra si vede
 * tutto, una versione sola.
 */
const OFFERTA: readonly VoceSezione[] = [
  { id: "contesto", etichetta: "Trattativa" },
  { id: "stato", etichetta: "Numeri" },
  { id: "conversazione", etichetta: "Chat" },
];

function Pannello() {
  const { sezione, setSezione, mostra } = useSezioneMobile("contesto");
  return (
    <>
      <section data-testid="trattativa" className={mostra("contesto")} />
      <section data-testid="numeri" className={mostra("stato")} />
      <SezioniMobili sezioni={OFFERTA} valore={sezione} onChange={setSezione} commenti={3} />
    </>
  );
}

afterEach(cleanup);

describe("la barra delle sezioni sul telefono", () => {
  it("mostra la sezione scelta e nasconde le altre solo sotto sm", () => {
    render(<Pannello />);
    expect(screen.getByTestId("trattativa").className).toBe("");
    expect(screen.getByTestId("numeri").className).toBe("max-sm:hidden");
    fireEvent.click(screen.getByRole("tab", { name: "Numeri" }));
    expect(screen.getByTestId("numeri").className).toBe("");
    expect(screen.getByTestId("trattativa").className).toBe("max-sm:hidden");
    expect(screen.getByRole("tab", { name: "Numeri" }).getAttribute("aria-selected")).toBe("true");
  });

  it("la chat porta il numero dei messaggi, e la barra sparisce sopra sm", () => {
    render(<Pannello />);
    expect(screen.getByRole("tab", { name: /Chat/ }).textContent).toBe("Chat3");
    expect(screen.getByRole("tablist").className).toContain("sm:hidden");
  });
});
