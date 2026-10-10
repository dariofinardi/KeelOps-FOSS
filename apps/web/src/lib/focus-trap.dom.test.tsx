// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useFocusTrap } from "./focus-trap";

/**
 * Dove va il fuoco quando si apre una finestra o un pannello.
 *
 * Il difetto che ha portato a questo test: si prendeva il primo elemento
 * focalizzabile, che nel markup è la **✕ di chiusura** — così una finestra
 * fatta per scrivere si apriva col fuoco sul pulsante che la chiude, e
 * l'`autoFocus` messo sul campo non serviva a niente (15/08/2026).
 */
function Modal({ children }: { children: React.ReactNode }) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  return (
    <div ref={ref}>
      <button aria-label="Chiudi">✕</button>
      {children}
    </div>
  );
}

describe("fuoco iniziale di finestre e pannelli", () => {
  it("va sul primo campo da compilare, non sulla ✕", () => {
    render(
      <Modal>
        <input aria-label="Oggetto" />
        <input aria-label="Riferimento" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Oggetto"));
  });

  it("una tendina non prende il fuoco: una freccia cambierebbe lo stato del task", () => {
    render(
      <Modal>
        <select aria-label="Stato">
          <option>Da fare</option>
        </select>
        <textarea aria-label="Descrizione" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Descrizione"));
  });

  it("senza campi resta il primo focalizzabile: le conferme non cambiano", () => {
    render(
      <Modal>
        <button>Conferma</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Chiudi"));
  });

  it("chi vuole decidere lo dichiara, e vince su tutto", () => {
    render(
      <Modal>
        <input aria-label="Oggetto" />
        <input aria-label="Cerca" data-autofocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Cerca"));
  });

  it("un campo in sola lettura non è un campo da compilare", () => {
    render(
      <Modal>
        <input aria-label="Codice" readOnly />
        <input aria-label="Note" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Note"));
  });

  it("il fuoco non parte da una tendina: si aprirebbe addosso al pannello", () => {
    // Il campo di ricerca di una combo è un input, ma prenderlo APRE l'elenco:
    // nel dettaglio di un ticket il fuoco finiva su "Cerca un incontro…" e la
    // tendina copriva mezzo pannello (24/08/2026).
    render(
      <Modal>
        <input aria-label="Cerca un incontro…" data-no-autofocus />
        <textarea aria-label="Scrivi un commento…" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Scrivi un commento…"));
  });

  it("e nemmeno come ripiego, quando non c'è nessun campo", () => {
    render(
      <Modal>
        <input aria-label="Cerca un progetto…" data-no-autofocus />
        <button>Salva</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Chiudi"));
  });

  it("i selettori (colore, file) non sono campi da compilare", () => {
    render(
      <Modal>
        <input aria-label="Colore" type="color" />
        <input aria-label="Nome" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Nome"));
  });
});
