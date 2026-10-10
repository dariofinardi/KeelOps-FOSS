// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useUrlFilterHandoff } from "./useUrlFilterHandoff";

function Pagina({ apply }: { apply: (values: Record<string, string>) => void }) {
  useUrlFilterHandoff(["cliente", "stato"], apply);
  const location = useLocation();
  return <span data-testid="url">{location.search || "(vuota)"}</span>;
}

const monta = (url: string) => {
  const apply = vi.fn();
  render(
    <MemoryRouter initialEntries={[url]}>
      <Pagina apply={apply} />
    </MemoryRouter>,
  );
  return apply;
};

describe("consegna dei filtri via indirizzo", () => {
  it("applica i parametri e li toglie dall'indirizzo", () => {
    // Il filtro diventa una preferenza normale: se restasse nell'URL, un
    // ricaricamento rimetterebbe quello che l'utente ha appena tolto.
    const apply = monta("/offerte?cliente=c1");
    expect(apply).toHaveBeenCalledExactlyOnceWith({ cliente: "c1" });
    expect(screen.getByTestId("url")).toHaveTextContent("(vuota)");
  });

  it("passa più parametri insieme, una volta sola", () => {
    const apply = monta("/bacheche?cliente=c1&stato=s1");
    expect(apply).toHaveBeenCalledExactlyOnceWith({ cliente: "c1", stato: "s1" });
  });

  it("senza parametri non tocca niente", () => {
    const apply = monta("/offerte");
    expect(apply).not.toHaveBeenCalled();
  });

  it("i parametri estranei restano dov'erano", () => {
    // Altri usi dell'indirizzo (es. ?deal=<id> che apre un pannello) non sono
    // affar suo: si toglie solo ciò che si è consumato.
    const apply = monta("/offerte?cliente=c1&deal=d9");
    expect(apply).toHaveBeenCalledExactlyOnceWith({ cliente: "c1" });
    expect(screen.getByTestId("url")).toHaveTextContent("deal=d9");
  });
});
