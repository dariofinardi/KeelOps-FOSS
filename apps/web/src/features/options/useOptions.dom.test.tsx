import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CurrentUserContext } from "@/features/auth/useAuth";
import { useOptions } from "./useOptions";

/**
 * **Il portale non chiede le liste interne** (24/09/2026). Il pannello del
 * ticket è lo stesso per l'help desk e per il cliente, e chiede le sue tendine
 * con `useOptions`: per un cliente stati, tag, tipi di attività, progetti e
 * persone sono 403, e ogni rifiuto riempiva la console e faceva rileggere
 * l'utente. Per un interno le richieste partono come sempre.
 */
const INTERNE = [
  "/api/users/options",
  "/api/projects",
  "/api/tags",
  "/api/activity-types",
  "/api/task-statuses",
];

function Tendine() {
  useOptions({ module: "TICKET" });
  return null;
}

function monta(role: string) {
  const chiamate: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      chiamate.push(String(url));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CurrentUserContext.Provider value={{ id: "me", name: "Io", role } as never}>
        <Tendine />
      </CurrentUserContext.Provider>
    </QueryClientProvider>,
  );
  return chiamate;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useOptions e il portale", () => {
  it("un interno chiede le liste delle tendine", async () => {
    const chiamate = monta("MEMBER");
    await waitFor(() =>
      expect(INTERNE.every((u) => chiamate.some((c) => c.startsWith(u)))).toBe(true),
    );
  });

  it("un cliente del portale non ne chiede nessuna", async () => {
    const chiamate = monta("PORTAL");
    // il tempo che servirebbe alle richieste per partire
    await new Promise((ok) => setTimeout(ok, 50));
    expect(chiamate.filter((c) => INTERNE.some((u) => c.startsWith(u)))).toEqual([]);
  });
});
