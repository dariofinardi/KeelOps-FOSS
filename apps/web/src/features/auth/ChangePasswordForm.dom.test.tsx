import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChangePasswordForm } from "./ChangePasswordForm";

const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: (url: string, init?: unknown) => post(url, init) };
});

const setup = (onDirtyChange = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChangePasswordForm onDirtyChange={onDirtyChange} />
    </QueryClientProvider>,
  );
  return { onDirtyChange };
};

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ChangePasswordForm", () => {
  it("segnala a chi lo ospita che ci sono campi compilati", () => {
    // Serve alla finestra del portale per non chiudersi buttando via quel che
    // si è scritto.
    const { onDirtyChange } = setup();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    type(/Password attuale/, "vecchia1234");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("non manda niente al server se le due nuove password non coincidono", async () => {
    post.mockClear();
    setup();
    type(/Password attuale/, "vecchia1234");
    type(/Nuova password/, "nuova12345");
    type(/Conferma nuova/, "nuova54321");
    fireEvent.click(screen.getByRole("button", { name: "Cambia password" }));
    expect(await screen.findByText("Le nuove password non coincidono")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("cambia la password e svuota i campi", async () => {
    post.mockClear().mockResolvedValue(undefined);
    setup();
    type(/Password attuale/, "vecchia1234");
    type(/Nuova password/, "nuova12345");
    type(/Conferma nuova/, "nuova12345");
    fireEvent.click(screen.getByRole("button", { name: "Cambia password" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/auth/change-password", expect.anything()),
    );
    expect(await screen.findByText(/Password aggiornata/)).toBeInTheDocument();
    // Campi svuotati: nessuna password resta a schermo dopo il cambio.
    expect(screen.getByLabelText<HTMLInputElement>(/Password attuale/).value).toBe("");
  });

  it("si possono disconnettere le altre sessioni", async () => {
    post.mockClear().mockResolvedValue(undefined);
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Disconnetti le altre sessioni/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/auth/logout-others", expect.anything()),
    );
    expect(await screen.findByText(/altre sessioni sono state disconnesse/)).toBeInTheDocument();
  });
});
