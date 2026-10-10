// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "./components/ui/toast";
import { ConfirmProvider } from "./components/ui/confirm";
import { App } from "./App";
import { edizione } from "./edition/rotte";

/**
 * Quale interfaccia riceve chi entra — e soprattutto che ognuna stia **dentro
 * il Router**.
 *
 * Nato da una pagina bianca vera (12/08/2026): il portale clienti era l'unico
 * ramo fuori dal `<BrowserRouter>`, e il giorno in cui la campanella e il
 * lettore di record hanno cominciato a navigare (`useRecordOpener` →
 * `useNavigate`) il portale è morto in fase di render, con un errore che si
 * leggeva solo nella console del browser. Il test rende l'App vera: se domani
 * un ramo torna fuori dal Router, qui si vede.
 */
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  // Nessun elenco serve al test: interessa che l'interfaccia si disegni.
  api: () => Promise.resolve([]),
  apiUpload: () => Promise.resolve({}),
}));
vi.mock("@/lib/push", () => ({
  pushSupported: () => false,
  getPushSubscription: () => Promise.resolve(null),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));

// Il cliente del portale. La fabbrica del mock è issata in cima al file:
// niente riferimenti a variabili esterne, l'utente si costruisce qui dentro.
vi.mock("./features/auth/useAuth", async () => {
  const react = await import("react");
  const utente = {
    id: "u1",
    name: "Sandro Cliente",
    email: "sandro@cliente.it",
    role: "PORTAL",
    locale: "it",
    canElevate: false,
    adminUntil: null,
  };
  return {
    useProviders: () => ({ data: { google: false }, isLoading: false }),
    useMe: () => ({ data: utente, isLoading: false }),
    useLogin: () => ({ mutate: vi.fn(), isPending: false }),
    useLogout: () => ({ mutate: vi.fn(), isPending: false }),
    useCurrentUser: () => utente,
    useInternalLists: () => false,
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

function renderApp() {
  // jsdom non ha matchMedia, e il tema lo interroga al montaggio.
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

  // …né EventSource, che la campanella apre per le notifiche in tempo reale.
  globalThis.EventSource ??= class {
    close() {}
  } as unknown as typeof EventSource;

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

describe("App: ogni interfaccia dentro il Router", () => {
  // The customer portal comes with the ticket module: not in the community build.
  it.skipIf(!edizione.moduli.has("ticket"))(
    "il portale clienti si disegna (i componenti che navigano hanno il loro contesto)",
    async () => {
      renderApp();
      /**
       * Il portale arriva da un chunk a parte: si attende il primo pezzo vero.
       *
       * Il tempo è **esplicito e largo** perché questo test guarda la
       * *struttura* — che il portale stia dentro il Router — non la velocità.
       * Col limite predefinito (1s) la misura era di 600-900ms: nessun margine,
       * e su una macchina carica il deploy si fermava per un ritardo che non
       * riguardava il codice (19/08/2026, due volte). Una regressione di peso si
       * cerca nei chunk della build, non qui.
       */
      expect(await screen.findByText(/Supporto clienti/i, {}, { timeout: 15000 })).toBeTruthy();
    },
  );
});
