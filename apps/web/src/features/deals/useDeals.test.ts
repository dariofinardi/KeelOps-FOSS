import { describe, expect, it } from "vitest";
import { dealFiltersSchema } from "@kancrm/shared";
import { dealsQueryString } from "./useDeals";

/**
 * **Lo schema e l'indirizzo devono restare la stessa cosa.**
 *
 * Il 04/09/2026 non lo sono stati: il filtro «di chi sono le offerte» era nella
 * pagina, nello schema condiviso e nel server — ma non nella funzione che
 * costruisce la query. Cambiare la tendina non cambiava niente, e l'elenco
 * mostrava le offerte di tutti dicendo «quelle degli altri». Nessun errore, da
 * nessuna parte: il parametro veniva semplicemente lasciato cadere.
 *
 * Questo test confronta i due elenchi: chi aggiunge un filtro allo schema e si
 * dimentica di qui se lo sente dire subito.
 */
describe("i filtri delle offerte arrivano tutti al server", () => {
  /** Un valore plausibile per ogni campo dello schema. */
  const esempio: Record<string, unknown> = {
    owner: "mine",
    stageId: "stage-1",
    companyId: "company-1",
    value: "above",
    q: "acme",
    includeClosed: true,
    page: 2,
    pageSize: 50,
    sortBy: "title",
    sortDir: "desc",
    stalled: "senzaPasso",
    months: "2026-09,senza-data",
  };

  it("nessun campo dello schema resta per strada", () => {
    const campi = Object.keys(dealFiltersSchema.shape);
    const mancanti = campi.filter((campo) => !(campo in esempio));
    expect(
      mancanti,
      `campi nuovi nello schema senza un valore di prova qui: ${mancanti.join(", ")}`,
    ).toEqual([]);

    const query = new URLSearchParams(dealsQueryString(esempio));
    const persi = campi.filter((campo) => !query.has(campo));
    expect(
      persi,
      `filtri che la pagina imposta ma che NON arrivano al server: ${persi.join(", ")}`,
    ).toEqual([]);
  });

  it("«tutte» non si manda: è l'assenza di perimetro", () => {
    const query = new URLSearchParams(dealsQueryString({ owner: "all" }));
    expect(query.has("owner")).toBe(false);
    expect(new URLSearchParams(dealsQueryString({ owner: "others" })).get("owner")).toBe("others");
  });
});
