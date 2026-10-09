import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { PanelError } from "./panel-error";

describe("il pannello che non si apre", () => {
  const props = {
    notFound: "Questa richiesta non esiste più.",
    forbidden: "Questa richiesta non è tua.",
  };

  it("dice che il record non c'è più", () => {
    render(<PanelError error={new ApiError(404, "x")} {...props} onClose={vi.fn()} />);
    expect(screen.getByText("Questa richiesta non esiste più.")).toBeInTheDocument();
  });

  it("distingue «non c'è» da «non è tuo»", () => {
    render(<PanelError error={new ApiError(403, "x")} {...props} onClose={vi.fn()} />);
    expect(screen.getByText("Questa richiesta non è tua.")).toBeInTheDocument();
  });

  it("un guasto qualunque non diventa «non esiste»", () => {
    render(<PanelError error={new TypeError("rete")} {...props} onClose={vi.fn()} />);
    expect(screen.getByText("Questa richiesta non è tua.")).toBeInTheDocument();
  });

  it("offre la via d'uscita: un vicolo cieco è metà dello stesso difetto", () => {
    const chiudi = vi.fn();
    render(<PanelError error={new ApiError(404, "x")} {...props} onClose={chiudi} />);
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
    expect(chiudi).toHaveBeenCalledOnce();
  });
});
