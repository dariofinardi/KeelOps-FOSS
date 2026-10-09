import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateTaskWorld } from "./invalidate";

const keysInvalidated = (id?: string): string[][] => {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  invalidateTaskWorld(client, id);
  return spy.mock.calls.map((call) => (call[0]?.queryKey ?? []) as string[]);
};

describe("invalidateTaskWorld", () => {
  it("rinfresca tutti gli elenchi in cui un task può comparire", () => {
    // Offerte e ticket sono task: una modifica può cambiarli tutti. Prima ogni
    // modulo invalidava un sottoinsieme diverso, e qualche vista restava ferma.
    const keys = keysInvalidated().map((k) => k[0]);
    for (const key of ["tasks", "deals", "tickets", "dashboard"]) {
      expect(keys, `manca ${key}`).toContain(key);
    }
  });

  it("rinfresca anche ciò che dipende dai task: tag e progetti", () => {
    const keys = keysInvalidated().map((k) => k[0]);
    expect(keys).toContain("tags"); // i conteggi cambiano con i tag applicati
    expect(keys).toContain("projects"); // barra di avanzamento, progetto da offerta vinta
  });

  it("senza id non tocca i dettagli: non c'è un record aperto", () => {
    expect(keysInvalidated().every((k) => k.length === 1)).toBe(true);
  });

  it("con un id rinfresca il dettaglio e la sua cronologia", () => {
    // Lo stesso id può essere aperto come task, offerta o ticket: si invalidano
    // tutti e tre invece di indovinare quale sia.
    const keys = keysInvalidated("x1");
    for (const key of ["task", "deal", "ticket", "task-comments", "task-activities"]) {
      expect(keys, `manca ${key}`).toContainEqual([key, "x1"]);
    }
  });
});
