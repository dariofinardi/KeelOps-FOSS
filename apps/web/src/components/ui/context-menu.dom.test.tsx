import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useContextMenu, useCreateAreaMenu } from "./context-menu";

/**
 * Elenco realistico: una riga col proprio menu dentro un contenitore che offre
 * "Nuovo task". È il punto in cui i due menu potrebbero pestarsi i piedi.
 */
function Lista({ onCreate }: { onCreate: (() => void) | null }) {
  const { open, menu } = useContextMenu();
  const { areaProps, menu: areaMenu } = useCreateAreaMenu("Nuovo task", onCreate);
  return (
    <div {...areaProps} data-testid="area" style={{ padding: 20 }}>
      <div
        data-testid="riga"
        onContextMenu={(e) => open(e, [{ label: "Apri", onSelect: () => {} }])}
      >
        Un task
      </div>
      {menu}
      {areaMenu}
    </div>
  );
}

const rightClick = (testId: string) => fireEvent.contextMenu(screen.getByTestId(testId));

describe("tasto destro su un elenco", () => {
  it("sullo spazio vuoto propone di creare", () => {
    render(<Lista onCreate={() => {}} />);
    rightClick("area");
    expect(screen.getByText("Nuovo task")).toBeInTheDocument();
  });

  it("sulla riga vince il menu della riga, non quello dell'area", () => {
    // L'evento risale al contenitore: senza la regola del defaultPrevented il
    // menu dell'area sostituirebbe quello del task appena aperto.
    render(<Lista onCreate={() => {}} />);
    rightClick("riga");
    expect(screen.getByText("Apri")).toBeInTheDocument();
    expect(screen.queryByText("Nuovo task")).not.toBeInTheDocument();
  });

  it("chi non può creare resta col menu del browser", () => {
    // Meglio il menu di sistema (ricarica, copia, ispeziona) di uno vuoto.
    render(<Lista onCreate={null} />);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const prevented = !screen.getByTestId("area").dispatchEvent(event);
    expect(prevented).toBe(false);
    expect(screen.queryByText("Nuovo task")).not.toBeInTheDocument();
  });

  it("la voce scelta esegue l'azione", () => {
    const onCreate = vi.fn();
    render(<Lista onCreate={onCreate} />);
    rightClick("area");
    fireEvent.click(screen.getByText("Nuovo task"));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
