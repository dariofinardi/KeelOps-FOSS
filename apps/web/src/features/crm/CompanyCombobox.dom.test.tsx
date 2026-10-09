import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CompanyCombobox } from "./CompanyCombobox";

/**
 * **Il selettore delle aziende non dev'essere ritagliabile.**
 *
 * Dentro la tabella degli utenti — che scorre in orizzontale, quindi ritaglia —
 * la tendina si apriva mozzata subito sotto la prima voce (02/09/2026). La cura
 * è disegnarla in un portale su `document.body`: qui si prova proprio quello,
 * che l'elenco **non** sia figlio del contenitore che scorre.
 */
vi.mock("./useCrm", () => ({
  // La ricerca per testo è quella del server: «contiene», quindi «jugaad srl»
  // non trova «Jugaad». Qui la si imita, per provare che la proposta arriva
  // comunque — dal confronto per nome equivalente.
  useCompanies: (q: string) => ({
    data: {
      items: [{ id: "c1", name: "Jugaad", city: "Milano" }].filter((c) =>
        c.name.toLowerCase().includes(q.toLowerCase()),
      ),
    },
  }),
  useCompanyMatch: (name: string) => ({
    data: {
      company: ["jugaad", "jugaad srl", "jugaad s.r.l."].includes(name.trim().toLowerCase())
        ? { id: "c1", name: "Jugaad" }
        : null,
    },
  }),
  useResolveCompany: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

describe("il selettore dell'azienda dentro un contenitore che scorre", () => {
  it("disegna l'elenco fuori dal contenitore, non dentro", () => {
    const { container } = render(
      <div className="overflow-x-auto" data-testid="contenitore" style={{ overflow: "auto" }}>
        <CompanyCombobox value={null} onChange={vi.fn()} />
      </div>,
    );
    // il campo di ricerca apre la tendina
    fireEvent.focus(screen.getByRole("textbox"));

    const elenco = document.querySelector("ul");
    expect(elenco, "la tendina non è stata disegnata").not.toBeNull();
    // è agganciata al corpo della pagina, non al contenitore che ritaglia
    expect(container.contains(elenco)).toBe(false);
    expect(elenco!.className).toContain("fixed");
  });
});

/**
 * **Niente doppioni** (16/09/2026): «Jugaad srl» quando c'è già «Jugaad» non si
 * crea — la tendina propone quella che c'è.
 */
describe("il nome di un'azienda che c'è già, scritto diverso", () => {
  const scrivi = (valore: string, props: Record<string, unknown> = {}) => {
    const onChange = vi.fn();
    render(<CompanyCombobox value={null} onChange={onChange} {...props} />);
    const campo = screen.getByRole("textbox");
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: valore } });
    return { onChange, campo };
  };

  it("propone l'azienda già presente al posto di crearne un'altra", () => {
    const { onChange } = scrivi("Jugaad srl");
    expect(screen.queryByText(/Crea azienda/)).toBeNull();
    fireEvent.mouseDown(screen.getByText("Usa «Jugaad», già presente"));
    expect(onChange).toHaveBeenCalledWith("c1");
  });

  it("Invio sceglie quella già presente", () => {
    const { onChange, campo } = scrivi("JUGAAD S.R.L.");
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c1");
  });

  it("un nome nuovo si offre di crearla", () => {
    scrivi("Integro");
    expect(screen.getByText('Crea azienda "Integro"')).toBeInTheDocument();
    expect(screen.queryByText(/già presente/)).toBeNull();
  });

  it("nel modulo, sotto il campo dice cosa succederà salvando", async () => {
    const { campo } = scrivi("Integro", { risolviAlSalvataggio: true });
    fireEvent.blur(campo);
    expect(await screen.findByText("Salvando si crea l'azienda «Integro»")).toBeInTheDocument();
  });
});
