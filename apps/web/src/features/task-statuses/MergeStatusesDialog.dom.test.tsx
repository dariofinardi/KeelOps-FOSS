import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TaskStatus } from "@kancrm/shared";
import { MergeStatusesButton } from "./MergeStatusesDialog";

/**
 * La fusione **elimina** lo stato di partenza e non si annulla: la protezione
 * sono le due domande in fila, e la prima serve solo se porta il numero dei
 * record. Qui si prova che quel numero e la parola "eliminato" arrivino
 * davanti agli occhi **prima** che parta la chiamata — dopo non servono più.
 */

const confirm = vi.fn();
const post = vi.fn();

vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => confirm }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({
    data: {
      tasks: 12,
      trashed: 2,
      recurrences: 0,
      dealStages: 0,
      closes: false,
      reopens: false,
      flags: [],
    },
    isLoading: false,
  }),
  useMutation: (options: { mutationFn: () => unknown }) => ({
    mutate: () => {
      post();
      void options.mutationFn();
    },
    isPending: false,
  }),
}));
vi.mock("@/lib/api", () => ({
  api: vi
    .fn()
    .mockResolvedValue({ migrated: 12, trashed: 2, deleted: "In review", flagsMoved: [] }),
  ApiError: class extends Error {},
}));

const status = (id: string, name: string): TaskStatus =>
  ({ id, name, category: "DEV", color: "#000", order: 0, isClosed: false }) as TaskStatus;

const setup = () => {
  render(
    <MergeStatusesButton
      category={"DEV" as never}
      statuses={[status("s1", "In review"), status("s2", "Da testare")]}
    />,
  );
  fireEvent.click(screen.getByLabelText("Fondi due stati di quest'area"));
  fireEvent.change(screen.getByLabelText(/Stato di partenza/), { target: { value: "s1" } });
  fireEvent.change(screen.getByLabelText(/Stato di arrivo/), { target: { value: "s2" } });
};

describe("finestra di fusione degli stati", () => {
  beforeEach(() => {
    confirm.mockReset();
    post.mockReset();
  });

  it("dice in anticipo che lo stato di partenza verrà eliminato", () => {
    setup();
    expect(screen.getByText(/verrà eliminato: resta vuoto/)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("chiede due volte: prima quanti record, poi che non si torna indietro", async () => {
    confirm.mockResolvedValue(true);
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^Fondi$/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    const prima = confirm.mock.calls[0]![0] as { message: string };
    const seconda = confirm.mock.calls[1]![0] as { title: string; message: string };
    // La prima porta il numero, che è ciò che fa accorgere dello stato sbagliato.
    expect(prima.message).toContain("12");
    expect(prima.message).toContain("verrà eliminato");
    // La seconda parla solo di irreversibilità: due cose diverse da capire.
    expect(seconda.title).toMatch(/non è reversibile/);
    expect(seconda.message).toContain("eliminato");
    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it("dicendo di no alla prima non parte niente, e non si chiede la seconda", async () => {
    confirm.mockResolvedValue(false);
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^Fondi$/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(post).not.toHaveBeenCalled();
  });

  it("dicendo di no alla seconda non parte niente", async () => {
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^Fondi$/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(post).not.toHaveBeenCalled();
  });
});
