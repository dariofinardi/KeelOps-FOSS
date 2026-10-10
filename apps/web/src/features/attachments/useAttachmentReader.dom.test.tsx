// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { DocumentReaderProvider, useAttachmentReader } from "./useAttachmentReader";

/**
 * Il lettore documenti aperto da una **sbirciatina** che poi si congeda.
 *
 * Il difetto del 01/09/2026: la graffetta degli elenchi apre un pannello al
 * passaggio del cursore, e dentro quel pannello stava anche il lettore. Andando
 * col mouse verso il documento si usciva dalla sbirciatina, che dopo 250 ms si
 * chiudeva portandosi via il lettore — a schermo sembrava che il documento si
 * chiudesse da solo. Qui l'ospite sparisce di colpo, che è la stessa cosa.
 */
vi.mock("@/lib/api", () => ({
  api: vi.fn().mockResolvedValue({
    mode: "viewer",
    url: "/api/attachments/a1/file",
    name: "Articoli.xlsx",
    mimeType: null,
  }),
  ApiError: class extends Error {},
}));
// Il contenuto del documento non serve: qui si guarda il ciclo di vita.
vi.mock("./AttachmentViewer", () => ({ AttachmentViewer: () => <p>contenuto</p> }));

function Ospite() {
  const reader = useAttachmentReader();
  return (
    <>
      <button onClick={() => void reader.open("a1")}>Leggi</button>
      {reader.panel}
    </>
  );
}

/** Una sbirciatina: c'è finché il cursore la tiene, poi sparisce. */
function Sbirciatina() {
  const [visibile, setVisibile] = useState(true);
  return (
    <>
      <button onClick={() => setVisibile(false)}>congeda</button>
      {visibile && <Ospite />}
    </>
  );
}

describe("il lettore documenti e chi lo apre", () => {
  it("resta aperto quando la sbirciatina che l'ha aperto si congeda", async () => {
    render(
      <DocumentReaderProvider>
        <Sbirciatina />
      </DocumentReaderProvider>,
    );
    await act(async () => void fireEvent.click(screen.getByText("Leggi")));
    await waitFor(() => expect(screen.getByLabelText("Articoli.xlsx")).toBeInTheDocument());

    // Il mouse va verso il documento: la sbirciatina si chiude.
    fireEvent.click(screen.getByText("congeda"));
    expect(screen.queryByText("Leggi")).toBeNull(); // l'ospite non c'è più
    expect(screen.getByLabelText("Articoli.xlsx")).toBeInTheDocument(); // il documento sì
  });

  it("senza provider il lettore è locale, e chiude con il suo ospite (monitor vendite)", async () => {
    // Il guscio dei monitor vendite non monta il provider: il comportamento
    // storico resta, ed è giusto — lì il lettore lo apre una pagina, non una
    // sbirciatina che si congeda da sola.
    render(<Sbirciatina />);
    await act(async () => void fireEvent.click(screen.getByText("Leggi")));
    await waitFor(() => expect(screen.getByLabelText("Articoli.xlsx")).toBeInTheDocument());
    fireEvent.click(screen.getByText("congeda"));
    expect(screen.queryByLabelText("Articoli.xlsx")).toBeNull();
  });

  it("offre di scaricare il documento, ma non ai monitor vendite né al portale", async () => {
    // Chi ha letto un documento spesso lo vuole anche in locale (25/09/2026);
    // il monitor vendite no: il server a lui dà solo il lettore.
    for (const [role, atteso] of [
      ["MEMBER", true],
      ["SALES_MONITOR", false],
      // il portale clienti resta com'era: il bottone è dell'applicazione interna
      ["PORTAL", false],
    ] as const) {
      const { unmount } = render(
        <CurrentUserContext.Provider value={{ id: "me", name: "Io", role } as never}>
          <Ospite />
        </CurrentUserContext.Provider>,
      );
      await act(async () => void fireEvent.click(screen.getByText("Leggi")));
      await waitFor(() => expect(screen.getByLabelText("Articoli.xlsx")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Scarica" }) !== null).toBe(atteso);
      unmount();
    }
  });
});
