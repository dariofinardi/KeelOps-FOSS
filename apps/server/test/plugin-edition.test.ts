import { describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

prepareTestDb("plugin-edition");
const { moduliAttivi, portaPlugin } = await import("../src/edition/registry");
const { funzioniDellEdizione, rifiutoPerEdizione } = await import("../src/edition/plugin-edition");

/**
 * **I plugin e l'edizione** (08/10/2026): cosa un plugin vede (`ctx.funzioni`,
 * le porte) e quando non si monta (`edizione`, `richiede` nel manifesto).
 */
describe("funzioni dell'edizione per i plugin", () => {
  it("la commerciale ha i suoi moduli, e il modello locale se è configurato", () => {
    const commerciale = moduliAttivi("commerciale");
    expect([...funzioniDellEdizione(commerciale, false)].sort()).toEqual(
      commerciale.map((m) => m.nome).sort(),
    );
    expect(funzioniDellEdizione(commerciale, true).has("ollama")).toBe(true);
  });

  it("la community non ha moduli; il modello locale sì, se è configurato", () => {
    expect([...funzioniDellEdizione(moduliAttivi("community"), false)]).toEqual([]);
    expect([...funzioniDellEdizione(moduliAttivi("community"), true)]).toEqual(["ollama"]);
  });

  // The exported community tree has no timesheet module to lend the port.
  it.skipIf(moduliAttivi("commerciale").length === 0)(
    "la porta delle ore la presta il modulo timesheet, e solo lui",
    () => {
      const porta = portaPlugin("timesheet", moduliAttivi("commerciale")) as Record<
        string,
        unknown
      >;
      expect(Object.keys(porta).sort()).toEqual(["aggiungi", "meseChiuso"]);
      expect(portaPlugin("timesheet", moduliAttivi("community"))).toBeNull();
      expect(portaPlugin("inesistente", moduliAttivi("commerciale"))).toBeNull();
    },
  );
});

describe("quando un plugin non si monta", () => {
  const tutte = new Set(["ticket", "timesheet"]);
  it("senza richieste si monta ovunque", () => {
    expect(rifiutoPerEdizione({}, "community", new Set())).toBeNull();
  });
  it("«commerciale» si monta solo nella commerciale", () => {
    expect(rifiutoPerEdizione({ edizione: "commerciale" }, "commerciale", tutte)).toBeNull();
    expect(rifiutoPerEdizione({ edizione: "commerciale" }, "community", new Set())).toBe(
      "plugin dell'edizione commerciale",
    );
    expect(rifiutoPerEdizione({ edizione: "community" }, "community", new Set())).toBeNull();
  });
  it("un'edizione scritta male si dice, non si indovina", () => {
    expect(rifiutoPerEdizione({ edizione: "pro" }, "commerciale", tutte)).toMatch(/non valida/);
  });
  it("«richiede» elenca le funzioni che mancano", () => {
    expect(rifiutoPerEdizione({ richiede: ["timesheet"] }, "commerciale", tutte)).toBeNull();
    expect(rifiutoPerEdizione({ richiede: ["timesheet", "ollama"] }, "community", new Set())).toBe(
      "richiede funzioni assenti in questa edizione: timesheet, ollama",
    );
    expect(rifiutoPerEdizione({ richiede: "timesheet" }, "commerciale", tutte)).toMatch(/elenco/);
  });
});
