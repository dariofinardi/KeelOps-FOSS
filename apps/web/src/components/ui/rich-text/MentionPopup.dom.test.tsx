import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMentionPopup } from "./MentionPopup";

describe("elenco menzioni con la lista che arriva dopo", () => {
  it("la funzione people passata all'editor e' stabile e legge i dati freschi", () => {
    // Il difetto: l'editor cattura people() una volta e non ricostruisce le
    // estensioni. Se l'elenco arriva a cache fredda dopo la creazione, la
    // closure congelata restituirebbe sempre []. Qui: la funzione tornata deve
    // restare la stessa fra i render e vedere i dati nuovi.
    const { result, rerender } = renderHook(({ people }) => useMentionPopup(people), {
      initialProps: { people: () => [] as { id: string; name: string }[] },
    });
    const primo = result.current.people;
    expect(primo()).toEqual([]);

    rerender({ people: () => [{ id: "1", name: "Dario Ferri" }] });
    // Stessa identita' della funzione (l'editor la tiene) ma dati aggiornati.
    expect(result.current.people).toBe(primo);
    expect(result.current.people()).toEqual([{ id: "1", name: "Dario Ferri" }]);
  });
});
