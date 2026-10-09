import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PluginScheda } from "@kancrm/shared";
import { PluginsSection } from "./PluginsSection";

/**
 * La sezione Plugin di Sistema: si legge chi c'è (versione, copyright,
 * licenza, sommario nella lingua giusta) e si spegne **solo dopo una
 * conferma** — chi lo sta usando si vede chiudere la pagina in faccia.
 * Riaccendere invece non chiede niente.
 */

const confirm = vi.fn();
const mutate = vi.fn();

vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => confirm }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate, isPending: false, variables: undefined }),
}));
vi.mock("@/lib/api", () => ({ api: vi.fn(), ApiError: class extends Error {} }));

const scheda = (over: Partial<PluginScheda>): PluginScheda => ({
  nome: "QABox",
  titolo: "Qualità",
  versione: "0.2.0",
  schemaVersion: 2,
  nick: "qabox",
  copyright: "© 2026 Jugaad s.r.l.",
  licenza: "commerciale",
  sommario: { it: "Qualità per chi produce.", en: "Quality for manufacturers." },
  installato: true,
  motivo: null,
  attivo: true,
  ...over,
});

describe("sezione Plugin di Sistema", () => {
  beforeEach(() => {
    confirm.mockReset();
    mutate.mockReset();
  });

  it("mostra versione, copyright, licenza e sommario", () => {
    render(<PluginsSection plugins={[scheda({})]} />);
    expect(screen.getByText("Qualità")).toBeInTheDocument();
    expect(screen.getByText(/tabelle plugin_qabox_\* v2/)).toBeInTheDocument();
    expect(screen.getByText(/© 2026 Jugaad s\.r\.l\. · Licenza commerciale/)).toBeInTheDocument();
    expect(screen.getByText("Qualità per chi produce.")).toBeInTheDocument();
  });

  it("spegne solo dopo la conferma", async () => {
    confirm.mockResolvedValue(false);
    render(<PluginsSection plugins={[scheda({})]} />);
    fireEvent.click(screen.getByRole("button", { name: "Disattiva" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(mutate).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Disattiva" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ nome: "QABox", attivo: false }));
  });

  it("riaccende senza domande", async () => {
    render(<PluginsSection plugins={[scheda({ attivo: false })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Attiva" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ nome: "QABox", attivo: true }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("un plugin non installato non ha l'interruttore", () => {
    render(<PluginsSection plugins={[scheda({ installato: false, attivo: false })]} />);
    expect(screen.getByText("Non installato")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
