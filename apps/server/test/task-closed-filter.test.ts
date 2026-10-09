import { describe, expect, it } from "vitest";
import { closedTaskWhere } from "../src/modules/tasks/closed";

/**
 * La regola sta in `@kancrm/shared` (e lì è provata): qui si guarda solo che
 * diventi il pezzo di `where` giusto, perché è quel pezzo che, sommato a un
 * `statusId` chiuso, svuotava la lista.
 */
describe("il where dei task chiusi", () => {
  it("nasconde i chiusi quando non è stato chiesto niente di preciso", () => {
    expect(closedTaskWhere({})).toEqual({ status: { isClosed: false } });
  });

  it("non aggiunge nulla quando i chiusi devono entrare", () => {
    expect(closedTaskWhere({ statusId: "non-rinnova-piu" })).toEqual({});
  });
});
