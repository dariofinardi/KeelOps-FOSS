import { describe, expect, it } from "vitest";
import { mentionCandidates, resolveMentions } from "../src/modules/notifications/service";

/**
 * O1: le parole da cercare nel database sono quelle dopo una chiocciola in
 * testa a una parola — non un indirizzo email, che prima faceva caricare
 * l'intera tabella utenti.
 */
describe("mentionCandidates", () => {
  it("prende la prima parola di ogni menzione, in minuscolo e senza doppioni", () => {
    expect(mentionCandidates("Ciao @Vera Verdi e @aldo, @Vera lo sa?")).toEqual(["vera", "aldo"]);
  });

  it("un indirizzo email non è una menzione", () => {
    expect(mentionCandidates("scrivi a vera@x.local per il contratto")).toEqual([]);
    expect(mentionCandidates("nessuna chiocciola qui")).toEqual([]);
  });

  it("tiene apostrofi e trattini, si ferma a venti", () => {
    expect(mentionCandidates("@D'Angelo e @Anna-Maria")).toEqual(["d'angelo", "anna-maria"]);
    const tanti = Array.from({ length: 30 }, (_, i) => `@n${i}`).join(" ");
    expect(mentionCandidates(tanti)).toHaveLength(20);
  });
});

describe("resolveMentions", () => {
  const persone = [
    { id: "f", name: "Dario Ferri" },
    { id: "c", name: "Dario DF" },
    { id: "v", name: "Vera Verdi" },
  ];

  it("il nome intero chiama solo chi lo porta, non gli altri con lo stesso nome proprio", () => {
    expect(resolveMentions("@Dario Ferri guardi tu?", persone)).toEqual(["f"]);
  });

  it("il solo nome proprio chiama ancora tutti quelli che lo portano", () => {
    expect(resolveMentions("@dario ci sei?", persone).sort()).toEqual(["c", "f"]);
  });

  it("nome intero e nome proprio nello stesso testo valgono entrambi", () => {
    expect(resolveMentions("@Dario Ferri e @Vera", persone).sort()).toEqual(["f", "v"]);
    expect(resolveMentions("@Dario Ferri, poi @Dario", persone).sort()).toEqual(["c", "f"]);
  });

  it("due omonimi per intero si chiamano tutti e due", () => {
    const omonimi = [
      { id: "a", name: "Anna Neri" },
      { id: "b", name: "Anna Neri" },
    ];
    expect(resolveMentions("@Anna Neri", omonimi).sort()).toEqual(["a", "b"]);
  });
});
