// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HoverPanel } from "./hover-panel";

const setup = (onRowClick = vi.fn()) => {
  render(
    <div onClick={onRowClick} data-testid="riga">
      <HoverPanel label="2 messaggi in chat" trigger={<span>💬 2</span>}>
        <p>Ciao, come procede?</p>
      </HoverPanel>
    </div>,
  );
  return { trigger: screen.getByRole("button", { name: "2 messaggi in chat" }), onRowClick };
};

const passTime = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("HoverPanel", () => {
  it("si apre passando col cursore", () => {
    const { trigger } = setup();
    expect(screen.queryByText("Ciao, come procede?")).not.toBeInTheDocument();
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText("Ciao, come procede?")).toBeInTheDocument();
  });

  it("non sparisce mentre ci si entra dentro: si può scorrere la chat", () => {
    vi.useFakeTimers();
    try {
      const { trigger } = setup();
      fireEvent.mouseEnter(trigger);
      const panel = screen.getByRole("dialog", { name: "2 messaggi in chat" });

      // Il cursore lascia l'icona per entrare nel pannello: nell'attraversamento
      // il pannello non deve chiudersi in faccia.
      fireEvent.mouseLeave(trigger);
      fireEvent.mouseEnter(panel);
      passTime(500);
      expect(screen.getByText("Ciao, come procede?")).toBeInTheDocument();

      // Uscendo davvero, si chiude.
      fireEvent.mouseLeave(panel);
      passTime(500);
      expect(screen.queryByText("Ciao, come procede?")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("si chiude con un clic fuori", () => {
    const { trigger } = setup();
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Ciao, come procede?")).not.toBeInTheDocument();
  });

  it("si chiude con Esc", () => {
    const { trigger } = setup();
    fireEvent.mouseEnter(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Ciao, come procede?")).not.toBeInTheDocument();
  });

  it("partire dall'icona non trascina la card che la contiene", () => {
    // Nel kanban la card è trascinabile e ascolta il puntatore: senza fermare
    // l'evento, sbirciare la chat trascinerebbe il task in un'altra colonna.
    const onCardPointerDown = vi.fn();
    render(
      <div onPointerDown={onCardPointerDown}>
        <HoverPanel label="2 messaggi in chat" trigger={<span>💬 2</span>}>
          <p>Ciao, come procede?</p>
        </HoverPanel>
      </div>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "2 messaggi in chat" }));
    expect(onCardPointerDown).not.toHaveBeenCalled();
  });

  it("il clic sull'icona non apre la riga sottostante", () => {
    // L'icona vive dentro righe cliccabili che aprono il task: senza fermare
    // l'evento, sbirciare la chat aprirebbe anche il dettaglio.
    const { trigger, onRowClick } = setup();
    fireEvent.click(trigger);
    expect(screen.getByText("Ciao, come procede?")).toBeInTheDocument();
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
