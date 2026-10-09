import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { DealDetailDrawer } from "./DealDetailDrawer";

/**
 * Il pannello dell'offerta quando l'offerta non si apre. Interessa il caso
 * degli sviluppatori, che hanno la lente "giornate": dal task vedono il nome
 * dell'offerta collegata e possono seguirne il collegamento, ma il dettaglio
 * commerciale resta chiuso.
 */
const errore = { current: null as unknown };

vi.mock("./useDeals", () => ({
  useDealDetail: () => ({ data: undefined, error: errore.current }),
  useDealStages: () => ({ data: [] }),
  useUpdateDeal: () => ({ mutate: vi.fn() }),
  useDeleteDeal: () => ({ mutate: vi.fn() }),
}));

const apri = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DealDetailDrawer dealId="d1" onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("offerta che non si apre", () => {
  it("con la sola lente giornate spiega cosa manca, invece di restare a caricare", () => {
    errore.current = new ApiError(403, "Non hai accesso al modulo Offerte/CRM");
    apri();
    expect(screen.getByText("Informazioni non disponibili")).toBeTruthy();
    expect(screen.getByText(/carico in giornate/)).toBeTruthy();
  });

  it("se l'offerta non c'è più lo dice, senza parlare di permessi", () => {
    errore.current = new ApiError(404, "Offerta non trovata");
    apri();
    expect(screen.getByText("Offerta non trovata")).toBeTruthy();
  });

  it("mentre arriva, resta il caricamento", () => {
    errore.current = null;
    apri();
    expect(screen.getByText("Caricamento…")).toBeTruthy();
  });
});
