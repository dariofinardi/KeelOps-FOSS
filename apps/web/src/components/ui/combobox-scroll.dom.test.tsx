// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Combobox } from "./combobox";

const voci = (quante: number) =>
  Array.from({ length: quante }, (_, i) => ({
    id: `v${i}`,
    // Nomi in ordine sparso apposta: l'ordinamento è del componente.
    label: `Voce ${String(quante - i).padStart(3, "0")}`,
  }));

/**
 * Un elenco che cresce nel tempo — aziende, progetti, offerte — si cerca
 * scrivendo, ma si deve poter anche **sfogliare**: prima le voci oltre la
 * trentesima erano irraggiungibili se non si indovinava una parola del nome.
 */
describe("combo: ordine e scorrimento", () => {
  it("mostra le voci in ordine alfabetico, non nell'ordine ricevuto", () => {
    render(<Combobox value={null} onChange={() => {}} items={voci(5)} />);
    fireEvent.focus(screen.getByRole("textbox"));
    const righe = screen.getAllByRole("button").map((b) => b.textContent);
    expect(righe[0]).toBe("Voce 001");
    expect(righe[4]).toBe("Voce 005");
  });

  it("chi ha un ordine suo lo tiene: i membri del progetto restano in cima", () => {
    render(<Combobox value={null} onChange={() => {}} items={voci(3)} ordina={false} />);
    fireEvent.focus(screen.getByRole("textbox"));
    expect(screen.getAllByRole("button")[0]?.textContent).toBe("Voce 003");
  });

  it("oltre il primo blocco dice quante ne restano, e scorrendo le carica", () => {
    render(<Combobox value={null} onChange={() => {}} items={voci(70)} />);
    fireEvent.focus(screen.getByRole("textbox"));
    expect(screen.getByText(/Altre 40/)).toBeInTheDocument();

    const lista = screen.getByRole("list");
    // Il fondo raggiunto: jsdom non calcola i layout, quindi si dichiarano.
    Object.defineProperty(lista, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(lista, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(lista, "scrollTop", { value: 800, configurable: true });
    fireEvent.scroll(lista);
    expect(screen.getByText(/Altre 10/)).toBeInTheDocument();
  });

  it("cercando si riparte dal primo blocco: le voci caricate erano di un altro elenco", () => {
    render(<Combobox value={null} onChange={() => {}} items={voci(70)} />);
    const campo = screen.getByRole("textbox");
    fireEvent.focus(campo);
    const lista = screen.getByRole("list");
    Object.defineProperty(lista, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(lista, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(lista, "scrollTop", { value: 800, configurable: true });
    fireEvent.scroll(lista);
    fireEvent.change(campo, { target: { value: "Voce 0" } });
    expect(screen.getByText(/Altre 40/)).toBeInTheDocument();
  });
});
