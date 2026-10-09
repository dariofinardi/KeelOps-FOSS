import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProssimoPasso } from "./NextStep";

/**
 * **Il prossimo passo, in una riga** (17/09/2026). Il componente è uno per la
 * tabella, la pipeline e il monitor vendite: qui si prova come scrive i cinque
 * stati, che «Aggiungi» non apre la riga intorno, e che senza titolo mostri
 * solo la data — la forma che arriva al monitor vendite.
 */
const OGGI = "2026-09-17";
const passo = (dueDate: string | null) => ({
  dueDate,
  title: "Richiamare il cliente",
  assigneeName: "Vera Vendite",
});

describe("ProssimoPasso", () => {
  it("senza passo lo dice, e «Aggiungi» crea il task senza aprire la riga", () => {
    const onAggiungi = vi.fn();
    const onRiga = vi.fn();
    render(
      <div onClick={onRiga}>
        <ProssimoPasso passo={null} conclusa={false} oggi={OGGI} onAggiungi={onAggiungi} />
      </div>,
    );
    expect(screen.getByText("Nessun passo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Aggiungi/ }));
    expect(onAggiungi).toHaveBeenCalledTimes(1);
    expect(onRiga).not.toHaveBeenCalled();
  });

  it("il passo scaduto ha la data in rosso, con il perché nel suggerimento", () => {
    render(<ProssimoPasso passo={passo("2026-09-10")} conclusa={false} oggi={OGGI} />);
    const data = screen.getByTitle("Il prossimo passo è scaduto");
    expect(data.className).toContain("text-destructive");
    expect(screen.getByText("Richiamare il cliente")).toBeInTheDocument();
    expect(screen.getByText("· Vera Vendite")).toBeInTheDocument();
  });

  it("oggi si legge «oggi», senza data si legge «senza data»", () => {
    const { rerender } = render(<ProssimoPasso passo={passo(OGGI)} conclusa={false} oggi={OGGI} />);
    expect(screen.getByText("oggi").className).toContain("text-primary");
    rerender(<ProssimoPasso passo={passo(null)} conclusa={false} oggi={OGGI} />);
    expect(screen.getByText("senza data")).toBeInTheDocument();
  });

  it("gli altri task aperti si contano accanto", () => {
    render(<ProssimoPasso passo={passo("2026-09-30")} conclusa={false} oggi={OGGI} altri={2} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("un clic sul passo apre il task, non la riga", () => {
    const onApri = vi.fn();
    const onRiga = vi.fn();
    render(
      <div onClick={onRiga}>
        <ProssimoPasso passo={passo("2026-09-30")} conclusa={false} oggi={OGGI} onApri={onApri} />
      </div>,
    );
    fireEvent.click(screen.getByText("Richiamare il cliente"));
    expect(onApri).toHaveBeenCalledTimes(1);
    expect(onRiga).not.toHaveBeenCalled();
  });

  it("per il monitor vendite solo la data: nessun titolo, nessun nome", () => {
    render(<ProssimoPasso passo={{ dueDate: "2026-09-10" }} conclusa={false} oggi={OGGI} />);
    expect(screen.getByTitle("Il prossimo passo è scaduto")).toBeInTheDocument();
    expect(screen.queryByText("Richiamare il cliente")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("una trattativa conclusa non ha passo da mostrare né da aggiungere", () => {
    render(<ProssimoPasso passo={null} conclusa oggi={OGGI} onAggiungi={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Nessun passo")).toBeNull();
  });
});
