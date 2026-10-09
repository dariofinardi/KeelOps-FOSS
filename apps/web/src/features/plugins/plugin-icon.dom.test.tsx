import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Columns3, Puzzle } from "lucide-react";
import { iconaDelPlugin } from "./plugin-icon";

describe("l'icona di un plugin", () => {
  it("un file del plugin si disegna come maschera tinta del colore del testo", () => {
    const Icona = iconaDelPlugin({ icona: "icona.svg", iconaUrl: "/plugins/Personale/icona.svg" });
    const { container } = render(<Icona className="size-4" />);
    const el = container.querySelector("[data-icona-url]") as HTMLElement;
    expect(el.dataset.iconaUrl).toBe("/plugins/Personale/icona.svg");
    expect(el.style.maskImage).toContain("/plugins/Personale/icona.svg");
    expect(el.style.backgroundColor).toBe("currentcolor");
    expect(el.className).toContain("size-4");
  });

  it("lo stesso indirizzo dà lo stesso componente: la voce non si rimonta", () => {
    const a = iconaDelPlugin({ icona: "x.svg", iconaUrl: "/plugins/a/x.svg" });
    const b = iconaDelPlugin({ icona: "x.svg", iconaUrl: "/plugins/a/x.svg" });
    expect(a).toBe(b);
  });

  it("un nome del set è un'icona lucide, e un nome ignoto è il puzzle", () => {
    const Colonne = iconaDelPlugin({ icona: "columns-3", iconaUrl: null });
    expect(render(<Colonne className="size-4" />).container.innerHTML).toBe(
      render(<Columns3 className="size-4" />).container.innerHTML,
    );
    const Ignota = iconaDelPlugin({ icona: "non-esiste", iconaUrl: null });
    expect(render(<Ignota />).container.innerHTML).toBe(render(<Puzzle />).container.innerHTML);
  });
});
