// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { ProjectFormDialog } from "./ProjectFormDialog";

const mutate = vi.fn();
const createMutate = vi.fn();
vi.mock("./useProjects", () => ({
  useUpdateProject: () => ({ mutate, isPending: false }),
  useCreateProject: () => ({ mutate: createMutate, isPending: false }),
}));
// Le combo chiedono elenchi al server: qui non sono l'oggetto del test.
vi.mock("@/features/crm/CompanyCombobox", () => ({
  CompanyCombobox: () => <div>combo clienti</div>,
}));
vi.mock("@/features/deals/DealCombobox", () => ({
  DealCombobox: () => <div>combo offerte</div>,
}));

const progetto = {
  id: "p1",
  name: "Piattaforma KanCRM",
  description: "Sviluppo e affinamento",
  company: null,
  deal: null,
  color: null,
  icon: null,
};

/** Monta il form: senza `project` è "Nuovo progetto", con `project` è modifica. */
const render_ = (project?: Partial<typeof progetto>) => {
  const onClose = vi.fn();
  // Il campo descrizione è l'editor arricchito, che per le menzioni con "@"
  // interroga l'elenco delle persone: serve il contesto delle query.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CurrentUserContext.Provider
        value={{ id: "u1", name: "Tester", role: "ADMIN", canSeeDeals: true } as never}
      >
        <ConfirmProvider>
          <ProjectFormDialog
            project={project ? { ...progetto, ...project } : undefined}
            onClose={onClose}
          />
        </ConfirmProvider>
      </CurrentUserContext.Provider>
    </QueryClientProvider>,
  );
  return onClose;
};
const apri = (over: Partial<typeof progetto> = {}) => render_(over);

describe("ProjectFormDialog", () => {
  it("si apre sui valori salvati e li rimanda al server", async () => {
    // Lo stesso pannello serve il menù contestuale dell'elenco e il pulsante
    // "Modifica" dentro il progetto: un'azione offerta in un posto solo manda a
    // cercarla dove non c'è.
    apri();
    const nome = screen.getByLabelText("Nome") as HTMLInputElement;
    expect(nome.value).toBe("Piattaforma KanCRM");

    fireEvent.change(nome, { target: { value: "KanCRM" } });
    fireEvent.click(screen.getByText("Salva"));
    // Il salvataggio aspetta l'azienda (trovata o creata dal nome scritto).
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "p1", name: "KanCRM" }),
        expect.anything(),
      ),
    );
  });

  it("una descrizione vuota si salva come assente, non come stringa vuota", async () => {
    apri({ description: "" });
    fireEvent.click(screen.getByText("Salva"));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
        expect.anything(),
      ),
    );
  });

  it("chiudere senza toccare niente non chiede nulla", () => {
    const onClose = apri();
    fireEvent.click(screen.getByText("Annulla"));
    expect(onClose).toHaveBeenCalled();
  });

  it("senza progetto è il form di creazione e usa la mutazione di creazione", async () => {
    render_(); // nessun progetto → "Nuovo progetto"
    const nome = screen.getByLabelText("Nome") as HTMLInputElement;
    expect(nome.value).toBe("");
    fireEvent.change(nome, { target: { value: "Nuovo cantiere" } });
    fireEvent.click(screen.getByText("Crea progetto"));
    await waitFor(() =>
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Nuovo cantiere" }),
        expect.anything(),
      ),
    );
    // Il create non manda un id: quello è solo della modifica.
    expect(createMutate.mock.calls[0]![0]).not.toHaveProperty("id");
  });
});
