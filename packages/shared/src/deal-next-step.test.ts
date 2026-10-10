// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  StatoPasso,
  confrontaPerPasso,
  motiviOffertaFerma,
  passaFiltroFerme,
  primoPasso,
  statoPasso,
} from "./deal-next-step";

const OGGI = "2026-09-17";
const task = (id: string, dueDate: string | null) => ({ id, title: id, dueDate, assigneeName: null });

describe("il prossimo passo di un'offerta", () => {
  it("è il task aperto con la scadenza più vicina, anche se già passata", () => {
    const passo = primoPasso([task("tardi", "2026-10-01"), task("scaduto", "2026-09-10"), task("presto", "2026-09-20")]);
    expect(passo?.id).toBe("scaduto");
  });

  it("i task senza data vengono dopo quelli datati, ma contano se sono gli unici", () => {
    expect(primoPasso([task("senza", null), task("datato", "2026-12-31")])?.id).toBe("datato");
    expect(primoPasso([task("senza", null), task("altro", null)])?.id).toBe("senza");
  });

  it("senza task aperti non c'è passo", () => {
    expect(primoPasso([])).toBeNull();
  });
});

describe("lo stato del passo", () => {
  it("dice nessuno, scaduto, oggi, in programma o senza data", () => {
    expect(statoPasso(null, OGGI)).toBe(StatoPasso.NESSUNO);
    expect(statoPasso({ dueDate: "2026-09-16" }, OGGI)).toBe(StatoPasso.SCADUTO);
    expect(statoPasso({ dueDate: OGGI }, OGGI)).toBe(StatoPasso.OGGI);
    expect(statoPasso({ dueDate: "2026-09-18" }, OGGI)).toBe(StatoPasso.IN_PROGRAMMA);
    expect(statoPasso({ dueDate: null }, OGGI)).toBe(StatoPasso.SENZA_DATA);
  });
});

describe("quando un'offerta è ferma", () => {
  const aperta = (passo: { dueDate: string | null } | null, expectedCloseDate: string | null) => ({
    conclusa: false,
    passo,
    expectedCloseDate,
  });

  it("senza passo, con il passo scaduto, con la chiusura prevista passata", () => {
    expect(motiviOffertaFerma(aperta(null, null), OGGI)).toEqual(["senzaPasso"]);
    expect(motiviOffertaFerma(aperta({ dueDate: "2026-09-01" }, "2026-12-01"), OGGI)).toEqual(["passoScaduto"]);
    expect(motiviOffertaFerma(aperta({ dueDate: "2026-09-30" }, "2026-09-01"), OGGI)).toEqual(["chiusuraPassata"]);
  });

  it("le ragioni si sommano", () => {
    expect(motiviOffertaFerma(aperta(null, "2026-08-01"), OGGI)).toEqual(["senzaPasso", "chiusuraPassata"]);
  });

  it("un passo che scade oggi, o in programma, non la ferma; nemmeno una chiusura che è oggi", () => {
    expect(motiviOffertaFerma(aperta({ dueDate: OGGI }, OGGI), OGGI)).toEqual([]);
    expect(motiviOffertaFerma(aperta({ dueDate: null }, null), OGGI)).toEqual([]);
  });

  it("una trattativa conclusa non è mai ferma", () => {
    expect(motiviOffertaFerma({ conclusa: true, passo: null, expectedCloseDate: "2026-01-01" }, OGGI)).toEqual([]);
  });

  it("il filtro «tutte» prende qualunque ragione, gli altri la loro", () => {
    expect(passaFiltroFerme(["chiusuraPassata"], "tutte")).toBe(true);
    expect(passaFiltroFerme([], "tutte")).toBe(false);
    expect(passaFiltroFerme(["senzaPasso", "chiusuraPassata"], "passoScaduto")).toBe(false);
    expect(passaFiltroFerme(["senzaPasso"], "senzaPasso")).toBe(true);
  });
});

describe("ordinare per prossimo passo", () => {
  it("prima i datati dal più vicino, poi i senza data, in fondo chi non ha passo", () => {
    const offerte = [
      { id: "nessuno", passo: null },
      { id: "senzaData", passo: { dueDate: null } },
      { id: "ottobre", passo: { dueDate: "2026-10-01" } },
      { id: "scaduto", passo: { dueDate: "2026-09-01" } },
    ];
    expect([...offerte].sort(confrontaPerPasso).map((o) => o.id)).toEqual([
      "scaduto",
      "ottobre",
      "senzaData",
      "nessuno",
    ]);
  });
});
