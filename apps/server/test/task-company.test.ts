import { describe, expect, it } from "vitest";
import {
  companyIdOf,
  companyNameWhere,
  companyOf,
  companyWhere,
} from "../src/modules/tasks/company";

/**
 * **Il cliente di un task non è un suo campo**: arriva da cinque relazioni
 * diverse. La stessa precedenza serve per mostrarlo in elenco, per contarlo e
 * per filtrarci sopra — e se le tre forme divergono il filtro comincia a
 * nascondere righe che l'elenco mostra col cliente scritto sopra.
 */

const atlante = { id: "c-atlante", name: "Atlante" };
const altro = { id: "c-altro", name: "Altro cliente" };

describe("da dove arriva il cliente di un task", () => {
  it("il cliente scritto sul task vince su tutti", () => {
    expect(companyOf({ company: atlante, project: { company: altro } })).toEqual(atlante);
  });

  it("poi l'offerta collegata, poi quella che l'ha generato", () => {
    expect(companyOf({ relatedDeal: { company: atlante }, project: { company: altro } })).toEqual(
      atlante,
    );
    expect(companyOf({ sourceDeal: { company: atlante }, project: { company: altro } })).toEqual(
      atlante,
    );
  });

  it("poi il progetto, che è il caso delle bacheche", () => {
    expect(companyOf({ project: { company: atlante } })).toEqual(atlante);
    expect(companyOf({ relatedProject: { company: atlante } })).toEqual(atlante);
  });

  it("senza nessuna delle cinque vie, nessun cliente", () => {
    expect(companyOf({})).toBeNull();
    expect(companyOf({ project: { company: null } })).toBeNull();
  });

  it("l'id segue la stessa precedenza dell'oggetto mostrato", () => {
    // È questa la coppia che deve restare allineata: `companyOf` disegna la
    // riga, `companyIdOf` la conta nella tendina.
    expect(companyIdOf({ companyId: "c-atlante", project: { companyId: "c-altro" } })).toBe(
      "c-atlante",
    );
    expect(companyIdOf({ companyId: null, project: { companyId: "c-altro" } })).toBe("c-altro");
    expect(companyIdOf({})).toBeNull();
  });
});

describe("il where del filtro cliente", () => {
  it("copre tutte e cinque le vie, o filtrerebbe via righe che l'elenco mostra", () => {
    const where = companyWhere("c-atlante");
    expect(where.OR).toHaveLength(5);
    expect(where.OR).toContainEqual({ companyId: "c-atlante" });
    expect(where.OR).toContainEqual({ project: { companyId: "c-atlante" } });
  });

  it("per nome fa lo stesso: è quello che serve alla ricerca globale", () => {
    const where = companyNameWhere("Atlante");
    expect(where.OR).toHaveLength(5);
    expect(where.OR).toContainEqual({ company: { name: { contains: "Atlante" } } });
  });
});
