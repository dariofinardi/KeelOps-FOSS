import { describe, expect, it } from "vitest";
import { applyColumnOrder, reorderColumns } from "./useColumnOrder";

describe("applyColumnOrder", () => {
  const cols = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("mantiene l'ordine originale senza preferenza salvata", () => {
    expect(applyColumnOrder(cols, undefined).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(applyColumnOrder(cols, []).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("riordina secondo gli id salvati", () => {
    expect(applyColumnOrder(cols, ["c", "a", "b"]).map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("accoda le colonne non elencate, nell'ordine originale", () => {
    expect(applyColumnOrder(cols, ["c"]).map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("ignora gli id salvati che non esistono più", () => {
    expect(applyColumnOrder(cols, ["sparita", "b"]).map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  it("non muta l'array in ingresso", () => {
    const input = [{ id: "a" }, { id: "b" }];
    applyColumnOrder(input, ["b", "a"]);
    expect(input.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("reorderColumns", () => {
  it("sposta la colonna trascinata nella posizione del bersaglio", () => {
    expect(reorderColumns(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderColumns(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("è un no-op se sorgente e bersaglio coincidono o non esistono", () => {
    expect(reorderColumns(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
    expect(reorderColumns(["a", "b", "c"], "a", "zzz")).toEqual(["a", "b", "c"]);
  });
});
