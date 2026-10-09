import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNotificationStream } from "./useNotifications";
import { resetPendingChanges } from "@/features/realtime/pending-changes";

/** Finta connessione agli eventi: si tiene il gestore e spara messaggi a mano. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
  send(payload: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>));
  }
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  resetPendingChanges();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("smistamento degli eventi del server", () => {
  it("una notifica rinfresca la campanella", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useNotificationStream(), { wrapper });
    FakeEventSource.last!.send({ kind: "notification", id: "n1", text: "Ti hanno assegnato…" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications"] });
  });

  it("un record cambiato NON rinfresca niente: si annota e si aspetta l'utente", () => {
    // Il vincolo di tutta la funzione: nessun aggiornamento non richiesto.
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useNotificationStream(), { wrapper });
    FakeEventSource.last!.send({
      kind: "record-changed",
      records: [{ id: "t1", kind: "ADMIN" }],
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("un evento illeggibile non fa rinfrescare a caso", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useNotificationStream(), { wrapper });
    act(() => FakeEventSource.last!.onmessage?.({ data: "non è json" } as MessageEvent<string>));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("smontando si chiude la connessione: una sola per applicazione", () => {
    const { unmount } = renderHook(() => useNotificationStream(), { wrapper });
    const source = FakeEventSource.last!;
    unmount();
    expect(source.closed).toBe(true);
  });
});
