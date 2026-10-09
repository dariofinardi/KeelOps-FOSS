import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./toast";

/**
 * Un avviso deve sparire da sé, ma **non mentre lo si legge**: da quando ne
 * esistono con dentro un elenco (i lavori simili, 14/08/2026) quattro secondi e
 * mezzo non bastano più, e allungarli per tutti lascerebbe in mezzo anche i
 * "salvato". Da qui: durata scelta da chi lo mostra, e tempo in pausa mentre il
 * puntatore ci sta sopra.
 */
function Trigger({ duration }: { duration?: number }) {
  const toast = useToast();
  return (
    <button
      onClick={() =>
        toast(
          <div>
            <p>Lavori simili già fatti</p>
            <p>Acroform 4h</p>
          </div>,
          "info",
          duration ? { duration } : undefined,
        )
      }
    >
      mostra
    </button>
  );
}

const show = (duration?: number) =>
  render(
    <ToastProvider>
      <Trigger duration={duration} />
    </ToastProvider>,
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("avvisi", () => {
  it("un avviso può contenere più righe, non solo una frase", () => {
    show();
    fireEvent.click(screen.getByText("mostra"));
    expect(screen.getByText("Lavori simili già fatti")).toBeTruthy();
    expect(screen.getByText("Acroform 4h")).toBeTruthy();
  });

  it("sparisce da sé dopo la durata di default", () => {
    show();
    fireEvent.click(screen.getByText("mostra"));
    act(() => void vi.advanceTimersByTime(4400));
    expect(screen.queryByText("Acroform 4h")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByText("Acroform 4h")).toBeNull();
  });

  it("chi ha da far leggere può chiedere più tempo", () => {
    show(12_000);
    fireEvent.click(screen.getByText("mostra"));
    act(() => void vi.advanceTimersByTime(5000));
    // A cinque secondi quello normale sarebbe già sparito: questo no.
    expect(screen.queryByText("Acroform 4h")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(7100));
    expect(screen.queryByText("Acroform 4h")).toBeNull();
  });

  it("il tempo si ferma mentre ci si passa sopra, e riparte dopo", () => {
    show(6000);
    fireEvent.click(screen.getByText("mostra"));
    const avviso = screen.getByRole("status");

    fireEvent.mouseEnter(avviso);
    act(() => void vi.advanceTimersByTime(20_000)); // venti secondi a leggere
    expect(screen.queryByText("Acroform 4h")).toBeTruthy();

    fireEvent.mouseLeave(avviso);
    act(() => void vi.advanceTimersByTime(6100));
    expect(screen.queryByText("Acroform 4h")).toBeNull();
  });
});

/**
 * **Un avviso che dice «non è andata» può offrire di rimediare.** Nasce da
 * «Invia ugualmente» sulle richieste prese in carico da un collega: senza il
 * comando dentro all'avviso bisogna riscrivere il messaggio, e nel frattempo
 * l'avviso è già sparito.
 */
function ConAzione({ fai }: { fai: () => void }) {
  const toast = useToast();
  return (
    <button
      onClick={() => toast("Messaggio non inviato", "error", { azione: { etichetta: "Invia ugualmente", fai } })}
    >
      mostra
    </button>
  );
}

describe("un comando dentro l'avviso", () => {
  it("compare, e cliccandolo fa quello che dice", () => {
    const fai = vi.fn();
    render(
      <ToastProvider>
        <ConAzione fai={fai} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("mostra"));
    fireEvent.click(screen.getByText("Invia ugualmente"));
    expect(fai).toHaveBeenCalledTimes(1);
  });

  it("l'avviso se ne va appena si clicca: il comando non si dà due volte", () => {
    const fai = vi.fn();
    render(
      <ToastProvider>
        <ConAzione fai={fai} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("mostra"));
    fireEvent.click(screen.getByText("Invia ugualmente"));
    expect(screen.queryByText("Messaggio non inviato")).toBeNull();
  });

  it("dura più a lungo di un avviso normale: c'è da decidere, non solo da leggere", () => {
    const fai = vi.fn();
    render(
      <ToastProvider>
        <ConAzione fai={fai} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("mostra"));
    // oltre i 4,5 secondi di un avviso qualunque
    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.getByText("Invia ugualmente")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(7000));
    expect(screen.queryByText("Invia ugualmente")).toBeNull();
  });
});
