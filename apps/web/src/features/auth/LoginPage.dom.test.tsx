// Copyright (c) 2026 Jugaad s.r.l.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginPage } from "./LoginPage";

/**
 * **Sign-in with Google comes with its module** (08/10/2026). The server says
 * whether the SSO is configured; the button and the outcome messages come from
 * the commercial slot. Without the slot — the community — nothing about Google
 * appears, whatever the server says.
 */
const google = { modulo: true };
vi.mock("@/edition/slots", () => ({
  slot: {
    get AccessoGoogle() {
      return google.modulo ? () => <button type="button">Accedi con Google</button> : undefined;
    },
    get esitiAccessoGoogle() {
      return google.modulo ? { error: "Accesso con Google non riuscito. Riprova." } : undefined;
    },
  },
}));
vi.mock("./useAuth", () => ({
  useProviders: () => ({
    data: {
      email: { passwordReset: false, otp: false },
      google: { sso: true, picker: { enabled: false, clientId: "", apiKey: "", appId: "" } },
      demo: null,
    },
  }),
  useLogin: () => ({ mutate: vi.fn(), isPending: false }),
  useOtpLogin: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/analytics/DemoAnalytics", () => ({ SceltaStatistiche: () => null }));

const mostra = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginPage />
    </QueryClientProvider>,
  );

describe("l'accesso con Google nella pagina di accesso", () => {
  beforeEach(() => window.history.replaceState(null, "", "/?sso=error"));

  it("con il modulo: il pulsante, e l'esito del ritorno da Google", () => {
    google.modulo = true;
    mostra();
    expect(screen.getByRole("button", { name: "Accedi con Google" })).toBeInTheDocument();
    expect(screen.getByText("Accesso con Google non riuscito. Riprova.")).toBeInTheDocument();
  });

  it("senza il modulo: niente pulsante e niente esito, anche se il server dicesse sì", () => {
    google.modulo = false;
    mostra();
    expect(screen.queryByRole("button", { name: "Accedi con Google" })).toBeNull();
    expect(screen.queryByText(/Google/)).toBeNull();
  });
});
