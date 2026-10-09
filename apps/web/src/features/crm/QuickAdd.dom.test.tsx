import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuickAddContactDialog } from "./QuickAdd";

/**
 * **Il dialogo si rilegge a ogni apertura.**
 *
 * Sta montato per tutta la vita del form che lo ospita, e `useState` prende il
 * valore iniziale una volta sola: aprendolo DOPO aver scelto l'azienda
 * nell'offerta, il campo azienda restava vuoto e la persona nasceva orfana —
 * quindi fuori dall'elenco dei referenti di quel cliente, e l'offerta sembrava
 * non prenderla (24/08/2026, due contatti scollegati in produzione).
 */
const mutate = vi.fn();
/** Trova o crea: qui l'azienda scritta non c'è, e nasce con id `az-nuova`. */
const risolvi = vi.fn(async ({ name }: { name: string }) => ({
  id: "az-nuova",
  name,
  created: true,
}));
vi.mock("./useCrm", () => ({
  useUpsertContact: () => ({ mutate, isPending: false }),
  useResolveCompany: () => ({ mutate: vi.fn(), mutateAsync: risolvi, isPending: false }),
  useCompanyMatch: () => ({ data: { company: null } }),
  useCompanies: () => ({ data: { items: [{ id: "az-1", name: "RomagnaTech" }] } }),
}));
vi.mock("@/lib/unsaved-changes", () => ({
  isDirtyForm: () => false,
  useSaveOrDiscard: () => (options: { onDiscard: () => void }) => options.onDiscard(),
}));

function setup(defaultCompanyId: string | null) {
  const onCreated = vi.fn();
  const view = render(
    <QuickAddContactDialog
      open={false}
      onClose={vi.fn()}
      onCreated={onCreated}
      defaultCompanyId={defaultCompanyId}
    />,
  );
  return { view, onCreated };
}

describe("Nuovo contatto al volo", () => {
  it("riaperto, prende l'azienda scelta DOPO il primo montaggio", async () => {
    mutate.mockClear();
    // montato a offerta senza azienda, com'è all'apertura del form
    const { view, onCreated } = setup(null);
    // l'utente sceglie l'azienda nell'offerta, poi apre "nuova persona"
    view.rerender(
      <QuickAddContactDialog
        open
        onClose={vi.fn()}
        onCreated={onCreated}
        defaultCompanyId="az-1"
      />,
    );
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Dario" } });
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "Monti" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea e seleziona" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    // la persona nasce NELLA sua azienda, non orfana
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      firstName: "Dario",
      lastName: "Monti",
      companyId: "az-1",
    });
  });

  it("riaperto, non si porta dietro la bozza di prima", () => {
    mutate.mockClear();
    const onCreated = vi.fn();
    const props = { onClose: vi.fn(), onCreated, defaultCompanyId: "az-1" };
    const view = render(<QuickAddContactDialog open {...props} />);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Bozza" } });
    // chiuso senza creare ("butta via quel che hai scritto"), poi riaperto
    view.rerender(<QuickAddContactDialog open={false} {...props} />);
    view.rerender(<QuickAddContactDialog open {...props} />);
    expect(screen.getByLabelText("Nome")).toHaveValue("");
  });

  /**
   * **Nome, cognome e il nome dell'azienda, e si salva** (16/09/2026). Prima
   * l'azienda scritta contava solo se confermata dalla tendina, e salvando senza
   * farlo il contatto nasceva senza azienda: è successo in produzione il 09/09.
   */
  it("l'azienda scritta e non confermata si trova o si crea salvando", async () => {
    mutate.mockClear();
    risolvi.mockClear();
    render(<QuickAddContactDialog open onClose={vi.fn()} onCreated={vi.fn()} defaultCompanyId={null} />);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Roberto" } });
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "Fadel" } });
    fireEvent.change(screen.getByPlaceholderText("Cerca o crea un'azienda…"), {
      target: { value: "Integro SRL" },
    });
    // Nessun clic su «Crea azienda»: si salva e basta.
    fireEvent.click(screen.getByRole("button", { name: "Crea e seleziona" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(risolvi).toHaveBeenCalledWith({ name: "Integro SRL" });
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      firstName: "Roberto",
      lastName: "Fadel",
      companyId: "az-nuova",
    });
  });

  it("senza azienda scritta non si crea niente", async () => {
    mutate.mockClear();
    risolvi.mockClear();
    render(<QuickAddContactDialog open onClose={vi.fn()} onCreated={vi.fn()} defaultCompanyId={null} />);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Solo" } });
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "Persona" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea e seleziona" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(risolvi).not.toHaveBeenCalled();
    expect(mutate.mock.calls[0]![0]).toMatchObject({ companyId: null });
  });
});
