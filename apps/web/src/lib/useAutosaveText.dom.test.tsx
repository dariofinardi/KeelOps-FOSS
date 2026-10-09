import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useAutosaveText } from "./useAutosaveText";

const setup = (props: { value?: string | null; required?: boolean; singleLine?: boolean } = {}) => {
  const onSave = vi.fn();
  const view = renderHook(
    ({ value }) =>
      useAutosaveText({ value, onSave, delayMs: 500, required: props.required, singleLine: true }),
    { initialProps: { value: props.value ?? "Titolo iniziale" } },
  );
  const type = (text: string) =>
    act(() => {
      view.result.current.props.onChange({
        target: { value: text },
      } as React.ChangeEvent<HTMLInputElement>);
    });
  return { ...view, onSave, type };
};

describe("useAutosaveText", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("salva da solo a digitazione ferma, una volta sola", () => {
    const { onSave, type } = setup();
    type("Titolo n");
    type("Titolo nuovo");
    act(() => vi.advanceTimersByTime(499));
    expect(onSave).not.toHaveBeenCalled(); // mentre si scrive non parte
    act(() => vi.advanceTimersByTime(1));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Titolo nuovo");

    // Fermi lì, non riparte: il testo mandato non è più "da salvare".
    act(() => vi.advanceTimersByTime(5000));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("il campo che sparisce porta con sé quello che c'era scritto", () => {
    // È il difetto segnalato: scrivo nel titolo, clicco fuori, il pannello si
    // chiude senza che il campo emetta blur — e il testo spariva.
    const { onSave, type, unmount } = setup();
    type("Scritto e mai sfocato");
    unmount();
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Scritto e mai sfocato");
  });

  it("chiudendo dopo aver già salvato non risalva", () => {
    const { onSave, type, unmount } = setup();
    type("Testo");
    act(() => vi.advanceTimersByTime(500));
    unmount();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("Esc abbandona la bozza e non lascia passare la chiusura", () => {
    const { result, onSave, type } = setup();
    type("Ripensamento");
    const blur = vi.fn();
    const stopPropagation = vi.fn();
    act(() => {
      result.current.props.onKeyDown({
        key: "Escape",
        stopPropagation,
        currentTarget: { blur },
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });
    expect(stopPropagation).toHaveBeenCalled(); // il pannello resta aperto
    expect(result.current.value).toBe("Titolo iniziale");
    act(() => vi.advanceTimersByTime(5000));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Esc senza modifiche lascia chiudere il pannello", () => {
    const { result } = setup();
    const stopPropagation = vi.fn();
    act(() => {
      result.current.props.onKeyDown({
        key: "Escape",
        stopPropagation,
        currentTarget: { blur: vi.fn() },
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it("Invio salva subito uscendo dal campo", () => {
    const { result, onSave, type } = setup();
    type("Confermato con Invio");
    const preventDefault = vi.fn();
    act(() => {
      result.current.props.onKeyDown({
        key: "Enter",
        preventDefault,
        // Nel browser il blur emette l'evento; qui lo chiamiamo noi.
        currentTarget: { blur: () => act(() => result.current.props.onBlur()) },
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Confermato con Invio");
  });

  it("un titolo obbligatorio svuotato torna com'era, senza salvare il vuoto", () => {
    const { result, onSave, type } = setup({ required: true });
    type("   ");
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.props.onBlur());
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.value).toBe("Titolo iniziale");
  });

  it("il valore che arriva dal server sostituisce il campo fermo…", () => {
    const { result, rerender } = setup();
    rerender({ value: "Cambiato da un collega" });
    expect(result.current.value).toBe("Cambiato da un collega");
  });

  it("…ma non quello che si sta scrivendo", () => {
    const { result, rerender, type } = setup();
    type("Sto scrivendo");
    rerender({ value: "Cambiato da un collega" });
    expect(result.current.value).toBe("Sto scrivendo");
  });

  it("il testo appena salvato non torna indietro aspettando l'eco del server", () => {
    // Fra il salvataggio e il refetch il pannello continua a mostrare il nuovo
    // testo: prima poteva lampeggiare il vecchio.
    const { result, type, rerender } = setup();
    type("Nuovo titolo");
    act(() => vi.advanceTimersByTime(500));
    rerender({ value: "Titolo iniziale" }); // refetch ancora indietro
    expect(result.current.value).toBe("Nuovo titolo");
    rerender({ value: "Nuovo titolo" }); // eco arrivata
    expect(result.current.value).toBe("Nuovo titolo");
  });

  it("lo spazio che si sta battendo non sparisce quando torna l'eco del server", () => {
    // Difetto segnalato il 06/08/2026: si scrive "ciao ", il salvataggio parte da
    // solo e manda "ciao" (ripulito), il server risponde "ciao" — e la bozza
    // veniva riallineata togliendo lo spazio davanti al cursore, in mezzo a una
    // frase che l'utente stava ancora scrivendo.
    const { result, onSave, type, rerender } = setup({ value: "" });
    type("ciao sto scrivendo ");
    act(() => vi.advanceTimersByTime(500));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("ciao sto scrivendo");
    rerender({ value: "ciao sto scrivendo" }); // eco del salvataggio
    expect(result.current.value).toBe("ciao sto scrivendo ");

    // E la parola successiva si attacca a quella prima, non alla precedente.
    type("ciao sto scrivendo bene");
    act(() => vi.advanceTimersByTime(500));
    expect(onSave).toHaveBeenLastCalledWith("ciao sto scrivendo bene");
  });

  it("collegato a un input vero: si scrive, si salva, si chiude", () => {
    vi.useRealTimers();
    const onSave = vi.fn();
    function Campo() {
      const field = useAutosaveText({
        value: "Vecchio",
        onSave,
        singleLine: true,
        delayMs: 10_000,
      });
      return <input aria-label="Titolo" {...field.props} />;
    }
    const { unmount } = render(<Campo />);
    const input = screen.getByLabelText("Titolo");
    fireEvent.change(input, { target: { value: "Riscritto" } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Riscritto");
    unmount();
    expect(onSave).toHaveBeenCalledOnce();
  });
});
