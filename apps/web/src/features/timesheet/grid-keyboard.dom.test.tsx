import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HourCell } from "./TimesheetGrid";

/**
 * **La griglia si usa con le dita sui tasti**, come un foglio di calcolo: si
 * arriva su una casella con le frecce, si digita una cifra e si è già dentro,
 * Invio conferma e scende, Esc rimette il valore di prima (26/08/2026).
 *
 * Qui si provano i gesti su una griglia vera di due righe per due colonne: la
 * traduzione tasto→intenzione ha i suoi test in `grid-keys.test.ts`, questi
 * guardano che il fuoco si sposti davvero e che il valore torni indietro.
 */
const upsert = vi.fn();
vi.mock("./useTimesheet", () => ({
  useUpsertEntry: () => ({ mutate: upsert }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

function Griglia() {
  return (
    <table data-griglia>
      <tbody>
        {[0, 1].map((riga) => (
          <tr key={riga}>
            {[0, 1].map((colonna) => (
              <td key={colonna}>
                <HourCell
                  riga={riga}
                  colonna={colonna}
                  taskId={`t${riga}`}
                  date={`2026-08-2${colonna + 4}`}
                  value={riga + colonna}
                  editable
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const cella = (riga: number, colonna: number) =>
  document.querySelector<HTMLInputElement>(`input[data-riga="${riga}"][data-colonna="${colonna}"]`)!;

describe("griglia delle ore da tastiera", () => {
  it("le frecce spostano il fuoco fra le caselle", () => {
    render(<Griglia />);
    cella(0, 0).focus();
    fireEvent.keyDown(cella(0, 0), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cella(0, 1));
    fireEvent.keyDown(cella(0, 1), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cella(1, 1));
    fireEvent.keyDown(cella(1, 1), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cella(1, 0));
  });

  it("ai bordi non si esce: si resta dove si è", () => {
    render(<Griglia />);
    cella(0, 0).focus();
    fireEvent.keyDown(cella(0, 0), { key: "ArrowUp" });
    expect(document.activeElement).toBe(cella(0, 0));
    fireEvent.keyDown(cella(0, 0), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cella(0, 0));
  });

  it("da selezionata il campo è in sola lettura: i tasti li legge la griglia", () => {
    render(<Griglia />);
    expect(cella(0, 0).readOnly).toBe(true);
  });

  it("digitare una cifra entra in scrittura con dentro quella cifra", () => {
    render(<Griglia />);
    const campo = cella(0, 0);
    campo.focus();
    fireEvent.keyDown(campo, { key: "4" });
    expect(campo.readOnly).toBe(false);
    expect(campo.value).toBe("4");
  });

  it("Esc rimette il valore di prima e torna selezionata", () => {
    render(<Griglia />);
    const campo = cella(1, 1); // vale 2
    campo.focus();
    fireEvent.keyDown(campo, { key: "7" });
    expect(campo.value).toBe("7");
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(campo.value).toBe("2");
    expect(campo.readOnly).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("Invio conferma, salva e scende di una riga", () => {
    upsert.mockClear();
    render(<Griglia />);
    const campo = cella(0, 1); // vale 1
    campo.focus();
    fireEvent.keyDown(campo, { key: "5" });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t0", hours: 5 }),
      expect.anything(),
    );
    expect(document.activeElement).toBe(cella(1, 1));
  });

  it("Canc svuota la casella: zero ore cancella la riga del giorno", () => {
    upsert.mockClear();
    render(<Griglia />);
    const campo = cella(1, 0); // vale 1
    campo.focus();
    fireEvent.keyDown(campo, { key: "Delete" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 0 }),
      expect.anything(),
    );
  });

  it("Fine porta all'ultima colonna della riga, Home alla prima", () => {
    render(<Griglia />);
    cella(0, 0).focus();
    fireEvent.keyDown(cella(0, 0), { key: "End" });
    expect(document.activeElement).toBe(cella(0, 1));
    fireEvent.keyDown(cella(0, 1), { key: "Home" });
    expect(document.activeElement).toBe(cella(0, 0));
  });

  it("una casella in sola lettura non entra in scrittura", () => {
    render(
      <table data-griglia>
        <tbody>
          <tr>
            <td>
              <HourCell riga={0} colonna={0} taskId="t" date="2026-08-24" value={3} editable={false} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(document.querySelector("input")).toBeNull();
  });
});
