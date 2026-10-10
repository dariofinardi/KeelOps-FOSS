// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ForcePasswordChange } from "./ForcePasswordChange";

const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: (url: string, init?: unknown) => post(url, init) };
});

const setup = () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ForcePasswordChange name="Vera" />
    </QueryClientProvider>,
  );
  return client;
};

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("primo accesso con password provvisoria", () => {
  it("spiega perché si è lì e chiede la password ricevuta", () => {
    setup();
    expect(screen.getByText(/la password che stai usando è provvisoria/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password attuale/)).toBeInTheDocument();
  });

  it("non offre di disconnettere le altre sessioni: il reset le ha già chiuse", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Disconnetti le altre sessioni/ })).toBeNull();
  });

  it("cambiata la password rilegge chi si è, che è ciò che riapre l'applicazione", async () => {
    post.mockClear().mockResolvedValue(undefined);
    const client = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    type(/Password attuale/, "krtf-9m2q-vhx7");
    type(/Nuova password/, "sceltamia1");
    type(/Conferma nuova/, "sceltamia1");
    fireEvent.click(screen.getByRole("button", { name: "Cambia password" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/auth/change-password", expect.anything()),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me"] }));
  });

  it("si può uscire: chi ha perso la password provvisoria se la fa rifare", async () => {
    post.mockClear().mockResolvedValue(undefined);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/auth/logout", expect.anything()));
  });
});
