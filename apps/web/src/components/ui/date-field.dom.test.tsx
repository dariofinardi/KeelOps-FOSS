import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateField, TimeField, isPlausibleDate, isPlausibleTime } from "./date-field";

/**
 * Il bug: un <input type="date"> emette date complete mentre si digita l'anno
 * (0002-07-30, 0020-07-30, …). Salvandole si persiste un anno assurdo e il
 * re-render riporta il cursore all'inizio.
 */
describe("isPlausibleDate / isPlausibleTime", () => {
  it("accetta vuoto e date con anno 1900-2100, rifiuta gli anni parziali", () => {
    expect(isPlausibleDate("")).toBe(true);
    expect(isPlausibleDate("2026-07-30")).toBe(true);
    expect(isPlausibleDate("1900-01-01")).toBe(true);
    expect(isPlausibleDate("0002-07-30")).toBe(false);
    expect(isPlausibleDate("0020-07-30")).toBe(false);
    expect(isPlausibleDate("0202-07-30")).toBe(false);
    expect(isPlausibleDate("2101-01-01")).toBe(false);
    expect(isPlausibleDate("2026-07")).toBe(false);
  });

  it("accetta vuoto e orari HH:MM validi", () => {
    expect(isPlausibleTime("")).toBe(true);
    expect(isPlausibleTime("09:30")).toBe(true);
    expect(isPlausibleTime("23:59")).toBe(true);
    expect(isPlausibleTime("24:00")).toBe(false);
    expect(isPlausibleTime("09:60")).toBe(false);
    expect(isPlausibleTime("9:30")).toBe(false);
  });
});

describe("DateField", () => {
  const setup = (value = "2026-07-30") => {
    const onCommit = vi.fn();
    render(<DateField value={value} onCommit={onCommit} aria-label="data" />);
    return { onCommit, input: screen.getByLabelText("data") as HTMLInputElement };
  };

  it("non propaga gli anni parziali digitati (0002 → 0020 → 0202)", () => {
    const { onCommit, input } = setup();
    for (const partial of ["0002-07-30", "0020-07-30", "0202-07-30"]) {
      fireEvent.change(input, { target: { value: partial } });
    }
    expect(onCommit).not.toHaveBeenCalled();
    // Quel che si digita resta visibile: il cursore non viene riportato indietro.
    expect(input.value).toBe("0202-07-30");
  });

  it("propaga subito l'anno completo plausibile (Invio resta libero di inviare)", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "2027-08-15" } });
    expect(onCommit).toHaveBeenCalledWith("2027-08-15");
  });

  it("scarta il residuo non plausibile all'uscita dal campo", () => {
    const { onCommit, input } = setup("2026-07-30");
    fireEvent.change(input, { target: { value: "0006-07-30" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("2026-07-30");
  });

  it("svuotando il campo conferma null", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "" } });
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("Esc annulla la digitazione in corso", () => {
    const { onCommit, input } = setup("2026-07-30");
    fireEvent.change(input, { target: { value: "0006-07-30" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("2026-07-30");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("limita l'intervallo selezionabile con min/max", () => {
    const { input } = setup();
    expect(input.min).toBe("1900-01-01");
    expect(input.max).toBe("2100-12-31");
  });
});

describe("TimeField", () => {
  const setup = (value = "09:30") => {
    const onCommit = vi.fn();
    render(<TimeField value={value} onCommit={onCommit} aria-label="ora" />);
    return { onCommit, input: screen.getByLabelText("ora") as HTMLInputElement };
  };

  it("non salva a ogni tasto: conferma all'uscita dal campo", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "14:00" } });
    expect(onCommit).not.toHaveBeenCalled(); // niente salvataggio a metà digitazione
    fireEvent.change(input, { target: { value: "14:45" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("14:45");
  });

  it("conferma con Invio e svuota con null", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("uscire dal campo senza modifiche non salva nulla", () => {
    const { onCommit, input } = setup("09:30");
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("09:30");
  });
});
