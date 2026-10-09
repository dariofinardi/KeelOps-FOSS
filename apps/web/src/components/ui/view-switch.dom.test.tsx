import { Kanban, Table2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ViewSwitch, type ViewOption } from "./view-switch";

type Vista = "tabella" | "kanban";
const OPTIONS: Array<ViewOption<Vista>> = [
  { value: "tabella", label: "Tabella", icon: Table2, key: "T" },
  { value: "kanban", label: "Kanban", icon: Kanban, key: "K" },
];

const setup = (value: Vista = "tabella") => {
  const onChange = vi.fn();
  render(<ViewSwitch options={OPTIONS} value={value} onChange={onChange} />);
  return { onChange };
};

describe("ViewSwitch", () => {
  it("la scorciatoia è scritta nel suggerimento: altrimenti non la usa nessuno", () => {
    setup();
    expect(screen.getByRole("button", { name: "Tabella" })).toHaveAttribute("title", "Tabella (T)");
    expect(screen.getByRole("button", { name: "Kanban" })).toHaveAttribute("title", "Kanban (K)");
  });

  it("una lettera cambia vista", () => {
    const { onChange } = setup();
    fireEvent.keyDown(window, { key: "k" });
    expect(onChange).toHaveBeenCalledWith("kanban");
  });

  it("non ruba i tasti mentre si scrive in un campo", () => {
    // Senza questo, cercare "kanban" nella casella di ricerca cambierebbe vista
    // a ogni lettera.
    const { onChange } = setup();
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "k" });
    expect(onChange).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignora le combinazioni con Ctrl/Cmd/Alt", () => {
    // Ctrl+K è la ricerca globale: non deve anche cambiare vista.
    const { onChange } = setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });
});
