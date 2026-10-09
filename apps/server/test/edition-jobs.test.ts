import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { moduliAttivi } from "../src/edition/registry";

/**
 * I lavori pianificati dei moduli commerciali (08/10/2026): gli stessi quattro
 * che `index.ts` pianificava da sé prima della divisione in edizioni, con gli
 * stessi orari e la timezone aziendale.
 */
describe("lavori dei moduli dell'edizione", () => {
  const pianificati = (edizione: "community" | "commerciale") => {
    const voci: Array<{ quando: string; tz: unknown }> = [];
    const cron = {
      schedule: (quando: string, _fn: unknown, tz: unknown) => voci.push({ quando, tz }),
    } as never;
    const app = { log: { info() {}, error() {} } } as unknown as FastifyInstance;
    for (const modulo of moduliAttivi(edizione)) {
      modulo.job?.({ cron, app, tz: { timezone: "Europe/Rome" } });
    }
    return voci;
  };

  // The exported community tree has no commercial modules to schedule.
  it.skipIf(moduliAttivi("commerciale").length === 0)(
    "commerciale: promemoria del timesheet, assenze notturne, indice dei modelli",
    () => {
      const voci = pianificati("commerciale");
      expect(voci.map((v) => v.quando).sort()).toEqual(
        ["0 16 * * 5", "0 8 * * 1", "45 2 * * *", "30 3 * * *"].sort(),
      );
      expect(voci.every((v) => (v.tz as { timezone: string }).timezone === "Europe/Rome")).toBe(
        true,
      );
    },
  );

  it("community: nessuno", () => {
    expect(pianificati("community")).toEqual([]);
  });
});
