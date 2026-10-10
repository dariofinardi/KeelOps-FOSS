// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "./components/ui/toast";
import { ConfirmProvider } from "./components/ui/confirm";
import { App } from "./App";

/**
 * **Il lettore a schermo intero mostra il documento, e basta.**
 *
 * `/documento/:id` è quello che apre "Apri in una scheda". Stava dentro il
 * gruppo di rotte dell'AppShell, quindi si portava dietro barra laterale,
 * ricerca, menù utente e perfino una seconda barra di scorrimento: a schermo
 * pieno si guarda un documento, e l'applicazione intorno è solo ingombro
 * (18/08/2026).
 *
 * Basta spostare una riga per rimetterlo dentro il guscio, e a occhio non si
 * nota finché non si apre un allegato: da qui il test.
 */
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  api: () =>
    Promise.resolve({
      mode: "viewer",
      url: "/api/attachments/view/x",
      name: "CC_rm26.01ago.doc.p7m.pdf",
      mimeType: "application/pdf",
    }),
  apiUpload: () => Promise.resolve({}),
}));
vi.mock("@/lib/push", () => ({
  pushSupported: () => false,
  getPushSubscription: () => Promise.resolve(null),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));
// Un interno qualsiasi: è la sua interfaccia ad avere il guscio.
vi.mock("./features/auth/useAuth", async () => {
  const react = await import("react");
  const utente = {
    id: "u1",
    name: "Dario Interno",
    email: "dario@example.com",
    role: "MEMBER",
    locale: "it",
    canElevate: false,
    adminUntil: null,
    canSeeTickets: true,
  };
  return {
    useProviders: () => ({ data: { google: false }, isLoading: false }),
    useMe: () => ({ data: utente, isLoading: false }),
    useLogin: () => ({ mutate: vi.fn(), isPending: false }),
    useLogout: () => ({ mutate: vi.fn(), isPending: false }),
    useCurrentUser: () => utente,
    useInternalLists: () => true,
    useCanDownload: () => true,
    useAdminElevation: () => ({
      elevate: { mutate: vi.fn(), isPending: false },
      stepDown: { mutate: vi.fn(), isPending: false },
    }),
    useElevationCountdown: () => null,
    useForbiddenRefresh: () => undefined,
    CurrentUserContext: react.createContext(utente),
  };
});

function renderAt(path: string) {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  globalThis.EventSource ??= class {
    close() {}
  } as unknown as typeof EventSource;

  window.history.pushState({}, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("lettore a schermo intero", () => {
  it("mostra il documento senza il guscio dell'applicazione", async () => {
    renderAt("/documento/cmsyrnv5");

    // Il nome del file c'è: la pagina è quella giusta.
    expect(
      await screen.findByText("CC_rm26.01ago.doc.p7m.pdf", {}, { timeout: 15000 }),
    ).toBeInTheDocument();

    // E l'applicazione intorno non c'è: né menù, né ricerca, né uscita.
    expect(screen.queryByText("La mia giornata")).not.toBeInTheDocument();
    expect(screen.queryByText("Timesheet")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Cerca ovunque/i)).not.toBeInTheDocument();
  });

  it("le altre pagine il guscio ce l'hanno ancora", async () => {
    // Controprova: la rotta è stata spostata fuori dal guscio, non il guscio
    // tolto a tutti.
    renderAt("/timesheet");
    // Tempo esplicito e largo: si guarda la struttura, non la velocità (vedi
    // la nota in `App.dom.test.tsx`).
    await waitFor(() => expect(screen.getByText("La mia giornata")).toBeInTheDocument(), {
      timeout: 15000,
    });
  });
});
