// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { quiConPannello, useRitorno, useVaiA } from "./ritorno";

/**
 * **Si torna sempre da dove si è partiti** (21/10/2026): un salto porta con sé
 * l'etichetta; all'arrivo il ritorno compare nel posto giusto (pagina o
 * pannello), e tornando si ritrova la pagina con il pannello che era aperto.
 */
function Partenza() {
  const vaiA = useVaiA();
  const location = useLocation();
  return (
    <>
      <p data-testid="dove">{location.pathname + location.search}</p>
      <button
        onClick={() =>
          vaiA(
            "/progetti/p1",
            { etichetta: "Offerta «Rinnovo»" },
            quiConPannello(location, "deal", "d1"),
          )
        }
      >
        al progetto
      </button>
      <button onClick={() => vaiA("/bacheche?task=t1", { etichetta: "Offerte", record: "t1" })}>
        al task
      </button>
    </>
  );
}

function Arrivo({ record }: { record?: string }) {
  const ritorno = useRitorno(record);
  return ritorno ? (
    <button onClick={ritorno.torna}>← {ritorno.etichetta}</button>
  ) : (
    <p>nessun ritorno</p>
  );
}

function App() {
  return (
    <MemoryRouter initialEntries={["/offerte"]}>
      <Routes>
        <Route path="/offerte" element={<Partenza />} />
        <Route path="/progetti/:id" element={<Arrivo />} />
        <Route
          path="/bacheche"
          element={
            <>
              <Arrivo record="t1" />
              <Arrivo record="altro" />
              <Arrivo />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe("il ritorno", () => {
  it("dalla pagina d'arrivo si torna alla partenza, con il pannello che era aperto", () => {
    render(<App />);
    fireEvent.click(screen.getByText("al progetto"));
    fireEvent.click(screen.getByText("← Offerta «Rinnovo»"));
    expect(screen.getByTestId("dove").textContent).toBe("/offerte?deal=d1");
  });

  it("arrivando su un pannello il ritorno sta nel pannello di quel record, non altrove", () => {
    render(<App />);
    fireEvent.click(screen.getByText("al task"));
    expect(screen.getAllByText("← Offerte")).toHaveLength(1);
    expect(screen.getAllByText("nessun ritorno")).toHaveLength(2);
  });

  it("senza salto nessun ritorno", () => {
    render(
      <MemoryRouter initialEntries={["/progetti/p1"]}>
        <Arrivo />
      </MemoryRouter>,
    );
    expect(screen.getByText("nessun ritorno")).toBeTruthy();
  });
});
