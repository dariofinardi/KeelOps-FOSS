// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfilePage } from "./ProfilePage";

/**
 * La scheda dei calendari dentro Profilo. Si prova attraverso la pagina vera —
 * il componente non è esportato — con le risposte del server finte: qui
 * interessa cosa vede l'utente, non come arrivano i dati.
 */
const risposte: Record<string, unknown> = {};

vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  api: (path: string) => {
    const chiave = path.split("?")[0] ?? path;
    if (chiave in risposte) return Promise.resolve(risposte[chiave]);
    // Gli altri elenchi della pagina (progetti, bacheche) sono array vuoti.
    return Promise.resolve(chiave === "/api/calendar/feeds" ? { enabled: true, feeds: [] } : []);
  },
  apiUpload: () => Promise.resolve({}),
}));
vi.mock("@/features/auth/useAuth", () => ({
  useInternalLists: () => true,
  useCurrentUser: () => ({
    id: "u1",
    name: "Tester",
    role: "MEMBER",
    email: "t@x.it",
    // Utente normale: la scheda dei privilegi non si disegna nemmeno.
    canElevate: false,
    adminUntil: null,
  }),
  useAuth: () => ({ user: { id: "u1" } }),
  useAdminElevation: () => ({
    elevate: { mutate: vi.fn(), isPending: false },
    stepDown: { mutate: vi.fn(), isPending: false },
  }),
  useElevationCountdown: () => null,
}));
vi.mock("@/lib/push", () => ({
  pushSupported: () => false,
  getPushSubscription: () => Promise.resolve(null),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));

const mostra = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  for (const key of Object.keys(risposte)) delete risposte[key];
});

describe("calendari da sottoscrivere", () => {
  it("dice subito che sono in sola lettura", async () => {
    // Non è una cautela nostra: un calendario sottoscritto per indirizzo è una
    // sorgente, e nessun client può rimandare indietro una modifica.
    mostra();
    expect(await screen.findByText(/sola lettura/)).toBeTruthy();
  });

  it("mostra l'indirizzo da copiare per ogni calendario", async () => {
    risposte["/api/calendar/feeds"] = {
      enabled: true,
      feeds: [
        {
          id: "f1",
          scope: "MINE",
          targetId: null,
          label: "Le mie scadenze",
          lastReadAt: null,
          url: "https://crm.example.com/api/calendar/abc.ics",
        },
      ],
    };
    mostra();
    expect(await screen.findByText("Le mie scadenze")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByDisplayValue("https://crm.example.com/api/calendar/abc.ics")).toBeTruthy(),
    );
    // Un calendario già creato non si offre una seconda volta.
    expect(screen.queryByText(/^Le mie scadenze$/, { selector: "button" })).toBeNull();
  });

  it("senza indirizzo pubblico lo dice invece di dare un link monco", async () => {
    // I link del calendario sono assoluti per forza: li apre un programma su
    // un'altra rete. Senza indirizzo pubblico non c'è niente da copiare.
    risposte["/api/calendar/feeds"] = {
      enabled: true,
      feeds: [
        {
          id: "f1",
          scope: "MINE",
          targetId: null,
          label: "Le mie scadenze",
          lastReadAt: null,
          url: null,
        },
      ],
    };
    mostra();
    expect(await screen.findByText(/Manca l'indirizzo pubblico/)).toBeTruthy();
  });

  it("se l'amministratore li ha spenti, lo dice e offre di chiederli", async () => {
    // Davanti a una porta chiusa la cosa peggiore è un cartello che non dice a
    // chi bussare.
    risposte["/api/calendar/feeds"] = { enabled: false, requestPending: false, feeds: [] };
    mostra();
    expect(await screen.findByText(/La funzione non è disponibile/)).toBeTruthy();
    expect(screen.getByText(/Chiedi agli amministratori/)).toBeTruthy();
    expect(screen.queryByText("Le mie scadenze")).toBeNull();
  });

  it("richiesta già inviata: non si bussa due volte alla stessa porta", async () => {
    risposte["/api/calendar/feeds"] = { enabled: false, requestPending: true, feeds: [] };
    mostra();
    expect(await screen.findByText(/Richiesta già inviata/)).toBeTruthy();
    expect(screen.queryByText(/Chiedi agli amministratori/)).toBeNull();
  });

  it("avverte che l'indirizzo vale come una password", async () => {
    mostra();
    expect(await screen.findByText(/trattalo come una password/)).toBeTruthy();
  });
});
