// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";
import { ViewSearchProvider, useViewSearch, useViewSearchTarget } from "./view-search";

/**
 * Il canale vista↔topbar: la vista si registra, la "topbar" la vede; allo
 * smontaggio la registrazione sparisce (vista solo-globale); fuori dal
 * provider la registrazione è un no-op (il portale non ha la topbar).
 */

function FakeTopbar() {
  const target = useViewSearchTarget();
  return (
    <div>
      <span data-testid="mode">{target ? "locale" : "globale"}</span>
      <span data-testid="q">{target?.q ?? "-"}</span>
      <span data-testid="tag">{target?.tag ? target.tag.tagId || "(nessuno)" : "-"}</span>
    </div>
  );
}

function FakeView({ withTag }: { withTag: boolean }) {
  const [q, setQ] = useState("fattura");
  const [tagId, setTagId] = useState("t1");
  const stableSetQ = useCallback((value: string) => setQ(value), []);
  const stableSetTag = useCallback((id: string | null) => setTagId(id ?? ""), []);
  useViewSearch({
    q,
    setQ: stableSetQ,
    ...(withTag ? { tag: { tagId, setTagId: stableSetTag } } : {}),
  });
  return null;
}

describe("view-search (DOM)", () => {
  it("la vista registrata rende attiva la ricerca locale, con q e tag", () => {
    render(
      <ViewSearchProvider>
        <FakeTopbar />
        <FakeView withTag />
      </ViewSearchProvider>,
    );
    expect(screen.getByTestId("mode").textContent).toBe("locale");
    expect(screen.getByTestId("q").textContent).toBe("fattura");
    expect(screen.getByTestId("tag").textContent).toBe("t1");
  });

  it("senza tag registrato il filtro tag non esiste", () => {
    render(
      <ViewSearchProvider>
        <FakeTopbar />
        <FakeView withTag={false} />
      </ViewSearchProvider>,
    );
    expect(screen.getByTestId("tag").textContent).toBe("-");
  });

  it("smontata la vista si torna al solo-globale", () => {
    function Wrapper({ mounted }: { mounted: boolean }) {
      return (
        <ViewSearchProvider>
          <FakeTopbar />
          {mounted && <FakeView withTag={false} />}
        </ViewSearchProvider>
      );
    }
    const { rerender } = render(<Wrapper mounted />);
    expect(screen.getByTestId("mode").textContent).toBe("locale");
    rerender(<Wrapper mounted={false} />);
    expect(screen.getByTestId("mode").textContent).toBe("globale");
  });

  it("fuori dal provider la registrazione è un no-op (portale)", () => {
    // Non deve lanciare: il portale clienti usa la stessa pagina senza AppShell.
    expect(() => render(<FakeView withTag={false} />)).not.toThrow();
  });
});
