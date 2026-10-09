import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CurrentUser } from "@kancrm/shared";
import { useForbiddenRefresh } from "./useAuth";

/**
 * **I permessi cambiano anche mentre si lavora.**
 *
 * L'elevazione ad amministratore dura mezz'ora, e si può chiudere da un'altra
 * scheda: il 26/08/2026 è successo davvero — elevazione alle 12:47, rientro
 * alle 12:51 da un'altra finestra, e la scheda rimasta aperta continuava a
 * mostrare "Admin 24′" mentre la pagina Utenti tornava tre 403 in console e un
 * elenco vuoto. Al primo rifiuto si rilegge chi si è, e lo si dice.
 */
const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));

let onForbiddenHandler: (() => void) | null = null;
vi.mock("@/lib/api", async (importOriginal) => {
  const vero = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...vero,
    onForbidden: (handler: (() => void) | null) => {
      onForbiddenHandler = handler;
    },
  };
});

const admin = { id: "u1", name: "Dario", role: "ADMIN" } as CurrentUser;
const membro = { ...admin, role: "MEMBER" } as CurrentUser;

function monta(primo: CurrentUser, dopo: CurrentUser) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["me"], primo);
  // la rilettura di /me: la seconda risposta è quella che il server dà ADESSO
  const refetch = vi
    .spyOn(queryClient, "refetchQueries")
    .mockImplementation(async () => {
      queryClient.setQueryData(["me"], dopo);
    });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useForbiddenRefresh(), { wrapper });
  return { refetch, queryClient };
}

describe("al primo rifiuto del server si rilegge chi si è", () => {
  it("rilegge l'utente e avvisa che i privilegi non ci sono più", async () => {
    toast.mockClear();
    const { refetch, queryClient } = monta(admin, membro);
    onForbiddenHandler?.();
    await waitFor(() => expect(refetch).toHaveBeenCalledWith({ queryKey: ["me"] }));
    expect(queryClient.getQueryData(["me"])).toEqual(membro);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining("privilegi di amministratore"), "info"),
    );
  });

  it("se il ruolo non è cambiato non dice niente: il rifiuto era di altro genere", async () => {
    toast.mockClear();
    // un membro che tocca una rotta non sua riceve 403, ma non ha perso niente
    const { refetch } = monta(membro, membro);
    onForbiddenHandler?.();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });

  it("nemmeno quando i privilegi ci sono ancora (403 di un'altra rotta)", async () => {
    toast.mockClear();
    const { refetch } = monta(admin, admin);
    onForbiddenHandler?.();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });
});
