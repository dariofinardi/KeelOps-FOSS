import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { StatusesPage } from "./StatusesPage";

/**
 * **Un comando che fallisce deve dirlo dove si è agito.**
 *
 * Il 26/08/2026: si aggiungeva uno stato all'Area tecnica con l'elevazione
 * scaduta, il server rispondeva 403, e la riga rossa compariva in CIMA alla
 * pagina — mentre il modulo di aggiunta sta in fondo, dopo otto stati. Dallo
 * schermo non succedeva niente, e in console restavano tre 403.
 */
const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("@/features/tasks/useTasks", () => ({
  useTaskStatuses: () => ({
    data: [
      {
        id: "s1", name: "Da fare", category: "DEV", color: "#888", order: 0,
        isClosed: false, isWonTarget: false, isAssignedTarget: false,
        stopsRecurrence: false, isBillingMilestone: false, wipLimit: null,
      },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/features/tasks/activity-types", () => ({ useActivityTypes: () => ({ data: [] }) }));
vi.mock("@/features/auth/useAuth", () => ({
  useCurrentUser: () => ({ role: "ADMIN", manageableCategories: ["DEV"] }),
}));
// il server rifiuta: è il caso vero, l'elevazione non c'è più
vi.mock("@/lib/api", async (importOriginal) => {
  const vero = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...vero,
    api: () => Promise.reject(new vero.ApiError(403, "Riservato agli amministratori")),
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<StatusesPage />, { wrapper });
}

describe("stati: quando il server rifiuta", () => {
  it("l'aggiunta fallita si vede a schermo, non solo in cima alla pagina", async () => {
    toast.mockClear();
    renderPage();
    const campo = screen.getByPlaceholderText("Nuovo stato…");
    fireEvent.change(campo, { target: { value: "Pronto per DEV" } });
    // il modulo degli STATI, non quello dei tipi che sta più sotto
    fireEvent.submit(campo.closest("form")!);

    // l'avviso a schermo: è quello che si vede stando in fondo alla pagina
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Riservato agli amministratori", "error"),
    );
    // e il messaggio del server resta anche in cima, per chi torna su
    expect(screen.getAllByText("Riservato agli amministratori").length).toBeGreaterThan(0);
  });

  it("il messaggio è quello del server, non un «errore» generico", () => {
    expect(new ApiError(403, "Riservato agli amministratori").message).toBe(
      "Riservato agli amministratori",
    );
  });
});
