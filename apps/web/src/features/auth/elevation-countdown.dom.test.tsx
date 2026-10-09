import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useElevationCountdown } from "./useAuth";

/**
 * **Quando l'elevazione scade, la pagina deve tornare quella di prima.**
 *
 * Il caso vero (20/08/2026): elenco delle richieste aperto da elevato, quindi
 * con quelle di tutti; scaduta la mezz'ora il badge spariva in silenzio, le
 * righe restavano, e aprirne una dava 404 in console e un pannello vuoto.
 * Ricaricare il solo `/me` non bastava: il perimetro di OGNI risposta dipende
 * dal ruolo, quindi si invalida tutto e lo si dice a chi guarda.
 */
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("scadenza dei privilegi di amministratore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const monta = (adminUntil: string | null, onExpire?: () => void) => {
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useElevationCountdown(adminUntil, onExpire), { wrapper });
    return { ...hook, invalidate };
  };

  it("conta i minuti che restano", () => {
    const { result } = monta(new Date(Date.now() + 12 * 60_000).toISOString());
    expect(result.current).toBe(12);
  });

  it("alla scadenza ricarica tutto, non solo l'utente", () => {
    const { invalidate } = monta(new Date(Date.now() + 20_000).toISOString());
    expect(invalidate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30_000));
    expect(invalidate).toHaveBeenCalled();
    // Senza argomenti: tutte le query. Con `{queryKey:["me"]}` restavano in
    // pagina i dati raccolti da elevato — ed è il difetto che si sta chiudendo.
    expect(invalidate.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("lo annuncia a chi sta lavorando, una volta sola", () => {
    const annuncio = vi.fn();
    monta(new Date(Date.now() + 20_000).toISOString(), annuncio);
    act(() => vi.advanceTimersByTime(30_000));
    act(() => vi.advanceTimersByTime(60_000));
    expect(annuncio).toHaveBeenCalledTimes(1);
  });

  it("da utente normale non conta niente e non annuncia niente", () => {
    const annuncio = vi.fn();
    const { result } = monta(null, annuncio);
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current).toBeNull();
    expect(annuncio).not.toHaveBeenCalled();
  });
});
