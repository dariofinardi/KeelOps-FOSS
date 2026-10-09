import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TagPicker } from "./TagPicker";

/**
 * **Creare un tag e chiudere subito il pannello non deve perdere il tag.**
 *
 * L'applicazione al task stava nell'`onSuccess` passato a `mutate`, che React
 * Query salta se il componente non c'è più: il tag nasceva sul server e non
 * finiva mai sul task. Qui la creazione risponde DOPO che il picker è stato
 * smontato, e `onChange` deve arrivare lo stesso.
 */
let risolvi: (tag: { id: string; name: string; color: string | null }) => void = () => undefined;
vi.mock("./useTags", () => ({
  useTags: () => ({ data: [] }),
  useCreateTag: () => ({
    isPending: false,
    mutateAsync: () =>
      new Promise((ok) => {
        risolvi = ok;
      }),
  }),
}));

describe("creare un tag al volo", () => {
  it("lo applica anche se il pannello si è chiuso prima della risposta", async () => {
    const onChange = vi.fn();
    const { unmount } = render(<TagPicker value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Aggiungi un tag…"), {
      target: { value: "urgente" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Crea tag/ }));
    unmount(); // Esc sul pannello, prima che il server risponda
    risolvi({ id: "t1", name: "urgente", color: null });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([{ id: "t1", name: "urgente", color: null }]),
    );
  });

  it("non lo applica due volte se nel frattempo c'è già", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<TagPicker value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Aggiungi un tag…"), {
      target: { value: "urgente" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Crea tag/ }));
    // il task, nel frattempo, ha già quel tag (un altro giro l'ha messo)
    rerender(
      <TagPicker value={[{ id: "t1", name: "urgente", color: null }]} onChange={onChange} />,
    );
    risolvi({ id: "t1", name: "urgente", color: null });
    await new Promise((ok) => setTimeout(ok, 20));
    expect(onChange).not.toHaveBeenCalled();
  });
});
