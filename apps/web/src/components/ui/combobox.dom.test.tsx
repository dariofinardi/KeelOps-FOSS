import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Combobox } from "./combobox";

const clienti = [
  { id: "c1", label: "Coopselios (6)" },
  { id: "c2", label: "SirosLab (4)" },
  { id: "c3", label: "Zucchetti Software Giuridico (1)" },
];

const apri = () => fireEvent.focus(screen.getByPlaceholderText("Cerca un cliente…"));
const scrivi = (testo: string) =>
  fireEvent.change(screen.getByPlaceholderText("Cerca un cliente…"), { target: { value: testo } });

function setup(value: string | null = null, items = clienti) {
  const onChange = vi.fn();
  render(
    <Combobox
      value={value}
      onChange={onChange}
      items={items}
      placeholder="Cerca un cliente…"
      emptyLabel="Tutti i clienti"
    />,
  );
  return onChange;
}

describe("Combobox", () => {
  it("si scrive per restringere l'elenco", () => {
    // È il motivo per cui esiste: con decine di clienti, scorrere non è pratico.
    setup();
    apri();
    expect(screen.getByText("Coopselios (6)")).toBeInTheDocument();
    scrivi("siros");
    expect(screen.getByText("SirosLab (4)")).toBeInTheDocument();
    expect(screen.queryByText("Coopselios (6)")).not.toBeInTheDocument();
  });

  it("cerca dentro il nome, non solo dall'inizio", () => {
    setup();
    apri();
    scrivi("software");
    expect(screen.getByText("Zucchetti Software Giuridico (1)")).toBeInTheDocument();
  });

  it("scegliere una voce la comunica e chiude", () => {
    const onChange = setup();
    apri();
    scrivi("siros");
    fireEvent.click(screen.getByText("SirosLab (4)"));
    expect(onChange).toHaveBeenCalledWith("c2");
  });

  it("la voce «tutti» azzera il filtro", () => {
    const onChange = setup("c2");
    // Con una scelta attiva la combo mostra la riga compatta: la ✕ la toglie.
    fireEvent.click(screen.getByLabelText("Tutti i clienti"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("una ricerca senza risposte lo dice, invece di mostrare il vuoto", () => {
    setup();
    apri();
    scrivi("azienda che non esiste");
    expect(screen.getByText("Nessun risultato.")).toBeInTheDocument();
  });

  it("con molte voci ne disegna un blocco per volta, e dice quante restano", () => {
    // Con 200 clienti l'elenco aperto non deve diventare una pagina infinita:
    // se ne mostrano trenta, le altre arrivano scorrendo o cercando (le prove
    // dello scorrimento stanno in combobox-scroll.dom.test.tsx).
    const tanti = Array.from({ length: 200 }, (_, i) => ({
      id: `c${i}`,
      label: `Azienda ${String(i).padStart(3, "0")}`,
    }));
    setup(null, tanti);
    apri();
    expect(screen.getByText("Azienda 000")).toBeInTheDocument();
    expect(screen.queryByText("Azienda 100")).not.toBeInTheDocument();
    expect(screen.getByText(/Altre 170/)).toBeInTheDocument();
    scrivi("Azienda 100");
    expect(screen.getByText("Azienda 100")).toBeInTheDocument();
  });
});
