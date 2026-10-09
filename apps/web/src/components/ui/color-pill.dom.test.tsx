import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ColorPill } from "./color-pill";
import { StatusBadge } from "@/features/tasks/StatusBadge";
import type { TaskStatus } from "@kancrm/shared";

/**
 * La pastiglia colorata: stati, fasi e tipi passano tutti da qui.
 *
 * Il test guarda una cosa sola ma che si rompe in silenzio: **non va a capo**.
 * In una colonna stretta "In sviluppo" si spezzava dentro il bordo tondo
 * (15/08/2026), e finché erano tre copie identiche la correzione andava fatta
 * tre volte — con la terza dimenticata.
 */
const status = (name: string): TaskStatus => ({ id: "s1", name, color: "#2563eb" }) as TaskStatus;

describe("pastiglia colorata", () => {
  it("non va mai a capo, comunque sia lunga l'etichetta", () => {
    render(<ColorPill color="#2563eb" label="In attesa di risposta dal cliente" />);
    const pill = screen.getByText("In attesa di risposta dal cliente");
    expect(pill.className).toContain("whitespace-nowrap");
  });

  it("lo stato del task usa la stessa pastiglia, quindi la stessa regola", () => {
    render(<StatusBadge status={status("In sviluppo")} />);
    expect(screen.getByText("In sviluppo").className).toContain("whitespace-nowrap");
  });

  it("il colore arriva dal dato, non dal tema", () => {
    render(<ColorPill color="#ff0000" label="Bloccato" />);
    expect(screen.getByText("Bloccato").getAttribute("style")).toContain("rgb(255, 0, 0)");
  });
});

/**
 * Il pallino che lampeggia dice «c'è qualcosa di nuovo» **solo con il
 * pallino**: l'etichetta non si muove, e chi non vede il battito lo legge dal
 * testo nascosto. Da fermo, niente di tutto questo: una pastiglia che
 * lampeggiasse sempre non direbbe più niente (14/09/2026).
 */
describe("il pallino che lampeggia", () => {
  it("da ferma non lampeggia e non annuncia niente", () => {
    const { container } = render(<ColorPill color="#d97706" label="In attesa" />);
    expect(container.querySelector(".pallino-lampeggia")).toBeNull();
    expect(screen.queryByText("Nuovi messaggi")).toBeNull();
    expect(screen.getByText("In attesa").getAttribute("title")).toBeNull();
  });

  it("con pulse lampeggia il solo pallino, e lo dice a chi non lo vede", () => {
    const { container } = render(
      <ColorPill color="#d97706" label="In attesa" pulse pulseLabel="Nuovi messaggi" />,
    );
    const pallino = container.querySelector(".pallino-lampeggia") as HTMLElement;
    expect(pallino).not.toBeNull();
    // Il pallino porta il colore dello stato: l'animazione batte da lì al bianco.
    expect(pallino.style.backgroundColor).toBe("rgb(217, 119, 6)");
    // L'etichetta resta un testo fermo, fuori dal pallino.
    const etichetta = screen.getByText("In attesa", { exact: false });
    expect(etichetta.classList.contains("pallino-lampeggia")).toBe(false);
    // Per i lettori di schermo e per il passaggio del mouse.
    expect(screen.getByText("Nuovi messaggi").classList.contains("sr-only")).toBe(true);
    expect(etichetta.getAttribute("title")).toBe("Nuovi messaggi");
  });

  it("lo stato del ticket con messaggi non letti accende il pallino", () => {
    const { container } = render(<StatusBadge status={status("In attesa")} unread />);
    expect(container.querySelector(".pallino-lampeggia")).not.toBeNull();
  });
});
