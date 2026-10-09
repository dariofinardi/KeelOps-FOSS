import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";
import { ViewSearchProvider, useViewSearch } from "@/lib/view-search";
import { GlobalSearch } from "./GlobalSearch";

/**
 * **Il filtro invisibile.** La ricerca di una vista si ricorda in
 * `localStorage`, ma in modo globale il campo in topbar mostra la ricerca
 * globale: quel testo continuava a nascondere righe senza comparire da nessuna
 * parte. Si presentava come "Nessun progetto trovato con questi filtri" su
 * trenta progetti, con la barra dei filtri pulita (18/08/2026).
 */

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => () => undefined }));
vi.mock("@/features/tasks/useRecordOpener", () => ({
  useRecordOpener: () => ({ node: null, open: () => undefined }),
}));
vi.mock("./TopbarTagFilter", () => ({ TopbarTagFilter: () => null }));

function Vista({ iniziale }: { iniziale: string }) {
  const [q, setQ] = useState(iniziale);
  const setStable = useCallback((value: string) => setQ(value), []);
  useViewSearch({ q, setQ: setStable, placeholder: "Cerca un progetto…" });
  return <span data-testid="q-vista">{q || "(vuoto)"}</span>;
}

const monta = (iniziale: string) => {
  localStorage.setItem("kancrm-search-scope", JSON.stringify({ scope: "global" }));
  return render(
    <ViewSearchProvider>
      <GlobalSearch />
      <Vista iniziale={iniziale} />
    </ViewSearchProvider>,
  );
};

describe("filtro della vista, in modo globale", () => {
  it("si vede, invece di nascondere righe in silenzio", () => {
    monta("orione");
    expect(screen.getByTitle("Togli il filtro di questa vista")).toHaveTextContent("orione");
  });

  it("la ✕ lo svuota, e la vista torna completa", () => {
    monta("orione");
    fireEvent.click(screen.getByTitle("Togli il filtro di questa vista"));
    expect(screen.getByTestId("q-vista")).toHaveTextContent("(vuoto)");
    expect(screen.queryByTitle("Togli il filtro di questa vista")).not.toBeInTheDocument();
  });

  it("senza filtro non c'è niente da mostrare", () => {
    monta("");
    expect(screen.queryByTitle("Togli il filtro di questa vista")).not.toBeInTheDocument();
  });
});
