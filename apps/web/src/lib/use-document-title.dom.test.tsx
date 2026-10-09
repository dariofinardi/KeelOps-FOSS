// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useDocumentTitle } from "./use-document-title";

function Titolo({ title }: { title: string | null }) {
  useDocumentTitle(title);
  return null;
}

describe("il titolo della scheda", () => {
  it("mette il nome della pagina, e alla chiusura rimette quello di prima", () => {
    document.title = "KeelOps — Gestionale interno";
    const { unmount } = render(<Titolo title="Bacheche" />);
    expect(document.title).toBe("Bacheche — KeelOps");
    unmount();
    expect(document.title).toBe("KeelOps — Gestionale interno");
  });

  it("un pannello sopra una pagina fa da pila: chiuso lui, torna la pagina", () => {
    document.title = "KeelOps — Gestionale interno";
    const pagina = render(<Titolo title="Offerte" />);
    const pannello = render(<Titolo title="Fluid Sport" />);
    expect(document.title).toBe("Fluid Sport — KeelOps");
    pannello.unmount();
    expect(document.title).toBe("Offerte — KeelOps");
    pagina.unmount();
  });

  it("senza titolo non tocca niente: il dato può essere in caricamento", () => {
    document.title = "Progetti — KeelOps";
    const { unmount } = render(<Titolo title={null} />);
    expect(document.title).toBe("Progetti — KeelOps");
    unmount();
  });
});
