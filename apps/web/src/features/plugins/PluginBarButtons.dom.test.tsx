// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PluginBarraStato, PluginUiEntry } from "@kancrm/shared";
import { PluginBarButtons } from "./PluginBarButtons";

/**
 * **Il bottone di un plugin nella barra** (23/09/2026): il core disegna quello
 * che il plugin dice — colore del pallino, battito, titolo — e al clic apre la
 * pagina del plugin in un riquadro. Esc lo chiude, come ogni strato.
 */

let stato: PluginBarraStato | undefined;
const invalida = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: stato }),
  useQueryClient: () => ({ invalidateQueries: invalida }),
}));

const mcp = {
  nome: "mcp",
  titolo: "Interfaccia MCP (pro)",
  icona: "bot",
  iconaUrl: null,
  barra: { icona: "mcp-icona.svg", iconaUrl: "/plugins/mcp/mcp-icona.svg", statoUrl: "/plugins/mcp/api/barra", pannelloUrl: "/plugins/mcp/barra" },
} as unknown as PluginUiEntry;
let plugins: PluginUiEntry[] = [];
vi.mock("./usePlugins", () => ({ usePlugins: () => ({ data: plugins }) }));

describe("bottoni dei plugin nella barra", () => {
  beforeEach(() => {
    invalida.mockReset();
    plugins = [mcp, { ...mcp, nome: "altro", barra: null } as PluginUiEntry];
    stato = { tono: "acceso", lampeggia: false, titolo: "MCP · pseudonimizzazione accesa" };
  });

  it("solo chi dichiara la barra ha un bottone, col titolo che dice il plugin", () => {
    render(<PluginBarButtons />);
    const bottoni = screen.getAllByRole("button");
    expect(bottoni).toHaveLength(1);
    expect(bottoni[0]).toHaveAttribute("title", "MCP · pseudonimizzazione accesa");
    expect(document.querySelector('[data-tono="acceso"]')).not.toBeNull();
    expect(document.querySelector(".pallino-lampeggia")).toBeNull();
  });

  it("il pallino batte quando il plugin dice che c'è stata attività", () => {
    stato = { tono: "spento", lampeggia: true, titolo: "MCP · Claude ha appena letto" };
    render(<PluginBarButtons />);
    expect(document.querySelector('[data-tono="spento"].pallino-lampeggia')).not.toBeNull();
    expect(screen.getByText("Attività recente")).toBeInTheDocument();
  });

  it("senza pallino quando il tono è «nessuno»", () => {
    stato = { tono: "nessuno", lampeggia: false, titolo: "x" };
    render(<PluginBarButtons />);
    expect(document.querySelector("[data-tono]")).toBeNull();
  });

  it("al clic apre la pagina del plugin; Esc la chiude e lo stato si rilegge", () => {
    render(<PluginBarButtons />);
    fireEvent.click(screen.getByRole("button"));
    const cornice = document.querySelector("iframe");
    expect(cornice).toHaveAttribute("src", "/plugins/mcp/barra");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector("iframe")).toBeNull();
    expect(invalida).toHaveBeenCalledWith({ queryKey: ["plugin-barra", "mcp"] });
  });

  it("nessun plugin con la barra, nessun bottone", () => {
    plugins = [];
    const { container } = render(<PluginBarButtons />);
    expect(container).toBeEmptyDOMElement();
  });
});
