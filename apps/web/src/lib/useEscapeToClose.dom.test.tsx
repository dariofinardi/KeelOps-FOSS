import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useEscapeToClose } from "./useEscapeToClose";

function Strato({ active, onClose }: { active: boolean; onClose: () => void }) {
  useEscapeToClose(active, onClose);
  return null;
}

const esc = () => fireEvent.keyDown(window, { key: "Escape" });

describe("Esc chiude l'ultimo strato aperto", () => {
  it("chiude il pannello attivo", () => {
    const onClose = vi.fn();
    render(<Strato active onClose={onClose} />);
    esc();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uno strato spento non risponde", () => {
    const onClose = vi.fn();
    render(<Strato active={false} onClose={onClose} />);
    esc();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("con una conferma sopra un pannello, l'Esc chiude solo la conferma", () => {
    // È il motivo della pila condivisa: senza, l'Esc avrebbe chiuso entrambi e
    // la domanda sarebbe sparita insieme al pannello che stava proteggendo.
    const chiudiPannello = vi.fn();
    const chiudiConferma = vi.fn();
    render(
      <>
        <Strato active onClose={chiudiPannello} />
        <Strato active onClose={chiudiConferma} />
      </>,
    );
    esc();
    expect(chiudiConferma).toHaveBeenCalledOnce();
    expect(chiudiPannello).not.toHaveBeenCalled();
  });

  it("chiusa la conferma, l'Esc successivo chiude il pannello sotto", () => {
    const chiudiPannello = vi.fn();
    const { rerender } = render(
      <>
        <Strato active onClose={chiudiPannello} />
        <Strato active onClose={vi.fn()} />
      </>,
    );
    rerender(
      <>
        <Strato active onClose={chiudiPannello} />
        <Strato active={false} onClose={vi.fn()} />
      </>,
    );
    esc();
    expect(chiudiPannello).toHaveBeenCalledOnce();
  });

  it("l'ultima closure vince: chi chiude vede lo stato aggiornato", () => {
    // I pannelli ricostruiscono `requestClose` a ogni render (deve vedere le
    // modifiche più recenti): la pila non deve restare con la versione vecchia.
    const vecchia = vi.fn();
    const nuova = vi.fn();
    const { rerender } = render(<Strato active onClose={vecchia} />);
    rerender(<Strato active onClose={nuova} />);
    esc();
    expect(nuova).toHaveBeenCalledOnce();
    expect(vecchia).not.toHaveBeenCalled();
  });
});
