import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UpdatesToast } from "./UpdatesToast";
import { notePendingChanges, resetPendingChanges } from "./pending-changes";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const mostra = () => {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <UpdatesToast />
    </QueryClientProvider>,
  );
  return invalidate;
};

const arriva = (...ids: string[]) =>
  act(() => notePendingChanges(ids.map((id) => ({ id, kind: "ADMIN" }))));

afterEach(() => {
  resetPendingChanges();
  vi.restoreAllMocks();
});

describe("avviso di aggiornamenti", () => {
  it("finché non cambia niente non c'è niente a schermo", () => {
    mostra();
    expect(screen.queryByText("Aggiorna")).toBeNull();
  });

  it("compare quando il server dice che un record è cambiato", () => {
    mostra();
    arriva("t1");
    expect(screen.getByText("Un record è stato aggiornato")).toBeTruthy();
  });

  it("non ricarica niente da sé: aspetta il clic", () => {
    // È il punto di tutta la scelta: nessun elenco si riordina mentre lo leggi,
    // nessun campo si riscrive mentre lo scrivi.
    const invalidate = mostra();
    arriva("t1");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("altri cambiamenti fanno crescere il numero, non un secondo avviso", () => {
    mostra();
    arriva("t1");
    arriva("t2", "t3");
    expect(screen.getAllByText("Aggiorna")).toHaveLength(1);
    expect(screen.getByText("3 record sono stati aggiornati")).toBeTruthy();
  });

  it("lo stesso record che cambia dieci volte resta uno", () => {
    mostra();
    arriva("t1");
    arriva("t1");
    arriva("t1");
    expect(screen.getByText("Un record è stato aggiornato")).toBeTruthy();
  });

  it("il clic aggiorna e l'avviso se ne va", () => {
    const invalidate = mostra();
    arriva("t1");
    fireEvent.click(screen.getByText("Aggiorna"));
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByText("Aggiorna")).toBeNull();
  });

  it("si annuncia con cortesia: non interrompe chi sta scrivendo", () => {
    mostra();
    arriva("t1");
    const avviso = screen.getByRole("status");
    expect(avviso.getAttribute("aria-live")).toBe("polite");
    // Non è un dialogo e non prende il fuoco: resta dov'è, in fondo.
    expect(document.activeElement).toBe(document.body);
  });
});
