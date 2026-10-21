// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { etichettaDellaPagina, quiConPannello } from "./ritorno";

describe("da dove si torna", () => {
  it("la pagina di partenza si riscrive con il pannello aperto, se lo sa riaprire", () => {
    expect(quiConPannello({ pathname: "/offerte", search: "" }, "deal", "d1")).toBe(
      "/offerte?deal=d1",
    );
    // i parametri che c'erano restano
    expect(quiConPannello({ pathname: "/bacheche", search: "?view=table" }, "task", "t1")).toBe(
      "/bacheche?view=table&task=t1",
    );
    // una pagina che non riapre quel pannello: si torna alla pagina com'era
    expect(quiConPannello({ pathname: "/", search: "" }, "task", "t1")).toBeNull();
  });

  it("il nome della pagina è quello dell'area", () => {
    expect(etichettaDellaPagina("/")).toBe("La mia giornata");
    expect(etichettaDellaPagina("/offerte")).toBe("Offerte");
    expect(etichettaDellaPagina("/progetti/p1")).toBe("Progetti");
  });
});
