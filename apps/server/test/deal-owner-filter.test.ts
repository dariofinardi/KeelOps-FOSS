// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { dealOwnerWhere, ownerIdOf } from "../src/modules/deals/owner";

/**
 * **«Le mie offerte» è la domanda che ci si fa per prima**, e non aveva
 * risposta: con un centinaio di offerte si scorreva l'elenco intero cercando il
 * proprio nome (04/09/2026).
 *
 * Proprietario = il commerciale assegnato, o chi l'ha creata se non è assegnata
 * a nessuno. È la stessa definizione che decide chi la può modificare, e sono la
 * stessa cosa apposta: un'offerta che posso cambiare ma che non risulta mia
 * sarebbe una contraddizione difficile da spiegare.
 */
describe("di chi è un'offerta", () => {
  it("del commerciale assegnato; se non c'è, di chi l'ha creata", () => {
    expect(ownerIdOf({ assigneeId: "sara", creatorId: "dario" })).toBe("sara");
    expect(ownerIdOf({ assigneeId: null, creatorId: "dario" })).toBe("dario");
  });
});

describe("il filtro «di chi sono»", () => {
  it("«tutte» non restringe niente: nessuna condizione da aggiungere", () => {
    expect(dealOwnerWhere("all", "io")).toBeUndefined();
    expect(dealOwnerWhere(undefined, "io")).toBeUndefined();
  });

  it("«le mie» comprende quelle che ho creato e non ho ancora assegnato", () => {
    const dove = dealOwnerWhere("mine", "io");
    // Senza il secondo ramo un'offerta appena creata sparirebbe da entrambi i
    // lati del filtro: non mia perché non assegnata, non altrui perché è mia.
    expect(dove).toEqual({
      OR: [{ assigneeId: "io" }, { assigneeId: null, creatorId: "io" }],
    });
  });

  /**
   * Scritto per esteso e non come `NOT` delle mie: in SQL un confronto con
   * `NULL` non è falso ma *ignoto*, e un'offerta senza commerciale spariva da
   * tutti e due i lati (04/09/2026, trovata dal test che pretende «mie + altrui
   * = tutte»).
   */
  it("«degli altri» copre sia le assegnate ad altri sia le non assegnate di altri", () => {
    expect(dealOwnerWhere("others", "io")).toEqual({
      OR: [{ assigneeId: { notIn: ["io"] } }, { assigneeId: null, creatorId: { not: "io" } }],
    });
  });

  /**
   * La condizione va messa dentro un `AND`, mai stesa nel `where`: la ricerca
   * per titolo usa già un `OR`, e due `OR` fratelli nello stesso oggetto si
   * sovrascrivono — trappola già pagata da questo repository (CLAUDE.md).
   */
  it("resta un oggetto a sé, da comporre sotto AND senza schiacciare la ricerca", () => {
    const perimetro = dealOwnerWhere("mine", "io")!;
    const ricerca = { OR: [{ title: { contains: "acme" } }] };
    const composto = { ...ricerca, AND: [perimetro] };
    // La ricerca sopravvive, e il perimetro pure: nessuno dei due sparisce.
    expect(composto.OR).toEqual(ricerca.OR);
    expect(composto.AND[0]).toBe(perimetro);
  });
});
