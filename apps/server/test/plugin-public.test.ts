// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { isPubblica, leggiPubblici } from "../src/plugins/plugin-public";

describe("i percorsi pubblici di un plugin", () => {
  const nulla = () => undefined;

  it("legge prefissi, metodi e il percorso di health", () => {
    const regole = leggiPubblici(
      "mcp",
      { pubblici: ["POST /", "/oauth/", "/mcp"], health: "/health" },
      nulla,
    );
    expect(regole).toEqual([
      { method: "POST", prefix: "/" },
      { method: null, prefix: "/oauth/" },
      { method: null, prefix: "/mcp" },
      { method: "GET", prefix: "/health" },
    ]);
  });

  it("una voce malformata si scarta con un avviso, le altre restano", () => {
    const avvisi: string[] = [];
    const regole = leggiPubblici("x", { pubblici: ["senza-barra", "/ok"] }, (m) => avvisi.push(m));
    expect(regole).toEqual([{ method: null, prefix: "/ok" }]);
    expect(avvisi).toHaveLength(1);
    expect(leggiPubblici("x", { pubblici: "/tutto" }, (m) => avvisi.push(m))).toEqual([]);
    expect(avvisi).toHaveLength(2);
  });

  it("un prefisso con la barra copre il sottoalbero; senza, solo il percorso e i suoi figli", () => {
    const regole = leggiPubblici("x", { pubblici: ["/oauth/", "/mcp"] }, nulla);
    expect(isPubblica(regole, "GET", "/oauth/token")).toBe(true);
    expect(isPubblica(regole, "GET", "/oauthx")).toBe(false);
    expect(isPubblica(regole, "POST", "/mcp")).toBe(true);
    expect(isPubblica(regole, "POST", "/mcp/x")).toBe(true);
    expect(isPubblica(regole, "POST", "/mcpx")).toBe(false);
    expect(isPubblica(regole, "GET", "/")).toBe(false);
  });

  it("il metodo conta: POST / è il protocollo, GET / resta la pagina di chi è dentro", () => {
    const regole = leggiPubblici("mcp", { pubblici: ["POST /"] }, nulla);
    expect(isPubblica(regole, "POST", "/")).toBe(true);
    expect(isPubblica(regole, "post", "/")).toBe(true);
    expect(isPubblica(regole, "GET", "/")).toBe(false);
    expect(isPubblica(regole, "POST", "/qualsiasi")).toBe(true);
  });

  it("senza dichiarazioni, niente è pubblico", () => {
    expect(isPubblica(leggiPubblici("x", {}, nulla), "GET", "/")).toBe(false);
  });
});
