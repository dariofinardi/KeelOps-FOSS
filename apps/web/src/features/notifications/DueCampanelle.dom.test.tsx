import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationPanel } from "./NotificationBell";

/**
 * **La campanella è aperta in più posti insieme.**
 *
 * La tendina in alto, la finestra della giornata, il pallino sul campanello:
 * mostrano tutti la stessa cosa, e leggerla in uno la deve segnare letta in
 * tutti. Qui i pannelli sono due davvero, con la cache vera in mezzo — i test
 * che simulano gli hook non direbbero niente su questo.
 *
 * La risposta del server si fa aspettare apposta: la spunta deve comparire
 * **prima**, e in tutti e due.
 */
let sbloccaLettura: () => void = () => undefined;
const letta = new Set<string>();

vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  api: vi.fn(async (url: string, init?: { method?: string }) => {
    if (url.startsWith("/api/notifications/") && init?.method === "POST") {
      await new Promise<void>((risolvi) => {
        sbloccaLettura = () => {
          letta.add(url.split("/")[3]!);
          risolvi();
        };
      });
      return undefined;
    }
    if (url === "/api/notifications") {
      const righe = ["n1", "n2"].map((id) => ({
        id,
        type: "mention",
        text: `Avviso ${id}`,
        taskId: null,
        taskKind: null,
        readAt: letta.has(id) ? "2026-09-04T10:00:00.000Z" : null,
        createdAt: `2026-09-04T0${id === "n1" ? 9 : 8}:00:00.000Z`,
      }));
      return { notifications: righe, unreadCount: righe.filter((r) => r.readAt === null).length };
    }
    if (url === "/api/notification-preferences")
      return { items: [], emailDigest: false, emailDigestMinutes: 15 };
    return undefined;
  }),
}));
vi.mock("./useNotifications", async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  // Il canale in tempo reale qui non c'entra: aprirebbe una connessione vera.
  useNotificationStream: () => undefined,
}));

/** Come la tendina del campanello: cliccare una riga la chiude. */
function Tendina() {
  const [aperta, setAperta] = useState(true);
  return aperta ? <NotificationPanel onOpenRecord={() => setAperta(false)} /> : <span>chiusa</span>;
}

const insieme = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Tendina />
      <NotificationPanel onOpenRecord={vi.fn()} />
    </QueryClientProvider>,
  );
};

describe("due campanelle aperte sulla stessa cosa", () => {
  // Ogni prova riparte da due avvisi da leggere.
  beforeEach(() => letta.clear());

  it("segnata letta in una, si spunta subito anche nell'altra", async () => {
    insieme();
    // Due righe da leggere per pannello: quattro pulsanti in tutto.
    await waitFor(() => expect(screen.getAllByLabelText("Segna come letta")).toHaveLength(4));

    fireEvent.click(screen.getAllByLabelText("Segna come letta")[0]!);

    // Il server non ha ancora risposto, e la spunta c'è già di qua e di là.
    await waitFor(() => expect(screen.getAllByLabelText("Segna come letta")).toHaveLength(2));
    sbloccaLettura();
    await waitFor(() => expect(screen.getAllByLabelText("Segna come letta")).toHaveLength(2));
  });

  it("cliccando la riga il pannello si chiude, e l'altro si aggiorna lo stesso", async () => {
    insieme();
    await waitFor(() => expect(screen.getAllByLabelText("Segna come letta")).toHaveLength(4));

    fireEvent.click(screen.getAllByText("Avviso n1")[0]!);
    await screen.findByText("chiusa");

    // Ne resta uno solo, con una sola riga da leggere: quella appena aperta è
    // segnata anche qui, benché il pannello che l'ha aperta non esista più.
    await waitFor(() => expect(screen.getAllByLabelText("Segna come letta")).toHaveLength(1));
    sbloccaLettura();
  });
});
