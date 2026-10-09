import { describe, expect, it } from "vitest";
import { chipRiepilogo } from "./chip";

/**
 * Lo stile delle due pastiglie del riepilogo — «Miei (9) / Supervisionati (0)»
 * e ora anche le offerte. Sta in un posto solo da quando serve in due: era
 * scritto dentro `TaskGroup`, e la seconda copia sarebbe divergita al primo
 * ritocco (04/09/2026).
 */
describe("la pastiglia del riepilogo", () => {
  it("quella scelta si distingue, l'altra resta discreta", () => {
    const scelta = chipRiepilogo(true);
    expect(scelta).toContain("border-primary");
    expect(scelta).toContain("font-semibold");

    const altra = chipRiepilogo(false);
    expect(altra).not.toContain("border-primary");
    expect(altra).toContain("text-muted-foreground");
  });

  it("hanno la stessa forma: cambia il colore, non la geometria", () => {
    for (const forma of ["rounded-full", "px-2", "py-0.5", "text-xs"]) {
      expect(chipRiepilogo(true), forma).toContain(forma);
      expect(chipRiepilogo(false), forma).toContain(forma);
    }
  });
});
