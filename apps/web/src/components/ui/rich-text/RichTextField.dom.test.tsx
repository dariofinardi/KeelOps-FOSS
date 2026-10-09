import { describe, expect, it, vi } from "vitest";
import { richTextToPlain } from "@kancrm/shared";
import { fireEvent, render as renderRaw, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AutosaveText } from "@/lib/useAutosaveText";
import { RichText } from "./RichText";
import { DescriptionField } from "./DescriptionField";
import { RichTextField } from "./RichTextField";

/**
 * Il campo interroga l'elenco delle persone (per le menzioni con `@`), quindi
 * vuole il contesto delle query intorno.
 */
const render = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderRaw(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const field = (over: Partial<AutosaveText> = {}): AutosaveText => ({
  value: "",
  isDirty: false,
  flush: vi.fn(),
  discard: vi.fn(),
  setValue: vi.fn(),
  props: { value: "", onChange: vi.fn(), onBlur: vi.fn(), onKeyDown: vi.fn() },
  ...over,
});

describe("descrizione disegnata", () => {
  it("il testo scritto prima dell'editor resta testo, a capo compresi", () => {
    const { container } = render(<RichText value={"Prima riga\nSeconda"} />);
    expect(container.textContent).toBe("Prima riga\nSeconda");
    expect(container.querySelector("p")).toBeNull();
  });

  it("quello scritto con l'editor si disegna", () => {
    const { container } = render(<RichText value="<p>Con <strong>enfasi</strong></p>" />);
    expect(container.querySelector("strong")?.textContent).toBe("enfasi");
  });

  it("un testo con dentro un < non diventa marcatore", () => {
    // Vale la stessa regola del server: serve un marcatore vero, non un <.
    const { container } = render(<RichText value="va bene se x < y" />);
    expect(container.textContent).toBe("va bene se x < y");
  });
});

describe("campo descrittivo", () => {
  it("chi non può modificare legge e basta: niente barra", () => {
    render(<RichTextField field={field({ value: "<p>Solo lettura</p>" })} readOnly />);
    expect(screen.getByText("Solo lettura")).toBeTruthy();
    expect(screen.queryByLabelText("Grassetto (Ctrl+B)")).toBeNull();
  });

  it("mentre l'editor si carica il testo si vede già", () => {
    // L'editor è pesante e arriva dopo: chi apre un pannello per leggere non
    // deve guardare un rettangolo vuoto.
    render(<RichTextField field={field({ value: "<p>Già leggibile</p>" })} />);
    expect(screen.getByText("Già leggibile")).toBeTruthy();
  });

  it("Esc abbandona la bozza e il pannello resta aperto", () => {
    const discard = vi.fn();
    const onPanelKeyDown = vi.fn();
    render(
      <div onKeyDown={onPanelKeyDown}>
        <RichTextField field={field({ isDirty: true, discard })} />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText("Grassetto (Ctrl+B)"), { key: "Escape" });
    expect(discard).toHaveBeenCalled();
    expect(onPanelKeyDown).not.toHaveBeenCalled();
  });

  it("Esc senza modifiche lascia chiudere il pannello", () => {
    const onPanelKeyDown = vi.fn();
    render(
      <div onKeyDown={onPanelKeyDown}>
        <RichTextField field={field()} />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText("Grassetto (Ctrl+B)"), { key: "Escape" });
    expect(onPanelKeyDown).toHaveBeenCalled();
  });

  it("Ctrl+Invio salva subito", () => {
    const flush = vi.fn();
    render(<RichTextField field={field({ isDirty: true, flush })} />);
    fireEvent.keyDown(screen.getByLabelText("Corsivo (Ctrl+I)"), { key: "Enter", ctrlKey: true });
    expect(flush).toHaveBeenCalled();
  });
});

describe("Esc con la finestra grande aperta", () => {
  it("non butta la bozza: lascia che la finestra si chiuda da se'", () => {
    // La finestra grande e' renderizzata dentro il wrapper del campo: il suo Esc
    // lo gestisce lei. Se il wrapper lo trattenesse, butterebbe la bozza e la
    // finestra resterebbe aperta.
    const discard = vi.fn();
    const onPanelKeyDown = vi.fn();
    render(
      <div onKeyDown={onPanelKeyDown}>
        <RichTextField field={field({ isDirty: true, discard })} taskId="t1" />
      </div>,
    );
    fireEvent.click(screen.getByLabelText("Apri l'editor grande"));
    // Esc mentre la finestra e' aperta: il wrapper deve lasciar passare.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(discard).not.toHaveBeenCalled();
  });
});

describe("finestra grande", () => {
  it("si apre dal campo e porta gli strumenti che nel pannello non stanno", () => {
    render(<RichTextField field={field()} taskId="t1" dialogTitle="Consegna beta" />);
    fireEvent.click(screen.getByLabelText("Apri l'editor grande"));
    expect(screen.getByRole("dialog", { name: "Consegna beta" })).toBeTruthy();
    expect(screen.getByLabelText("Tabella 3×3")).toBeTruthy();
    expect(screen.getByLabelText("Inserisci immagine")).toBeTruthy();
  });

  it("senza un record salvato non si incollano figure, e lo dice", () => {
    // Le immagini vivono accanto al task: prima che esista non c'è un accanto.
    render(<RichTextField field={field()} taskId={null} />);
    fireEvent.click(screen.getByLabelText("Apri l'editor grande"));
    expect(screen.getByLabelText("Inserisci immagine")).toHaveProperty("disabled", true);
    expect(screen.getByText(/dopo il primo salvataggio/)).toBeTruthy();
  });
});

describe("dove la descrizione si legge e basta", () => {
  it("negli estratti resta testo: niente marcatori, niente tabelle", () => {
    // Sulle schede (kanban, elenco progetti) c'è spazio per due righe: si mostra
    // l'inizio di quello che c'è scritto, non il documento.
    expect(
      richTextToPlain("<p>Consegna <strong>beta</strong></p><table><tr><td>x</td></tr></table>"),
    ).toBe("Consegna beta\nx");
  });
});

describe("nei form di creazione", () => {
  it("basta il valore e come cambiarlo: nessuna bozza da salvare", () => {
    // Alla creazione non c'è niente da salvare finché non si preme "Crea":
    // il campo funziona lo stesso, senza flush né discard.
    const setValue = vi.fn();
    render(<RichTextField field={{ value: "<p>Bozza</p>", setValue }} taskId={null} />);
    expect(screen.getByText("Bozza")).toBeTruthy();
    expect(screen.getByLabelText("Grassetto (Ctrl+B)")).toBeTruthy();
  });

  it("l'Esc non viene trattenuto: chiude la finestra di creazione", () => {
    const onDialogKeyDown = vi.fn();
    render(
      <div onKeyDown={onDialogKeyDown}>
        <RichTextField field={{ value: "<p>Bozza</p>", setValue: vi.fn() }} />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText("Corsivo (Ctrl+I)"), { key: "Escape" });
    expect(onDialogKeyDown).toHaveBeenCalled();
  });
});

describe("campo descrizione dei form di creazione", () => {
  it("porta etichetta, editor e finestra grande, uguali ovunque", () => {
    // Esiste per non riscrivere le stesse quattro decisioni in ogni form: una
    // copia in più è un'occasione in più di chiamarlo "Note" da una parte.
    render(
      <DescriptionField
        value="<p>Bozza</p>"
        onChange={vi.fn()}
        dialogTitle="Descrizione del task"
      />,
    );
    expect(screen.getByText("Descrizione")).toBeTruthy();
    expect(screen.getByText("Bozza")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Apri l'editor grande"));
    expect(screen.getByRole("dialog", { name: "Descrizione del task" })).toBeTruthy();
  });

  it("le figure non si incollano finché il record non esiste", () => {
    render(<DescriptionField value="" onChange={vi.fn()} dialogTitle="Descrizione del task" />);
    fireEvent.click(screen.getByLabelText("Apri l'editor grande"));
    expect(screen.getByLabelText("Inserisci immagine")).toHaveProperty("disabled", true);
  });
});
