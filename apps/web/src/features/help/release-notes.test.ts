import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@kancrm/shared";
import { PRIMA_VERSIONE_COMMUNITY, RELEASE_NOTES, testoDellaVoce } from "./release-notes";

/**
 * Le note di rilascio si scrivono a mano, quindi il test guarda le poche cose
 * che a mano si sbagliano: una voce doppia, un numero fuori ordine, una data
 * scritta male, una voce vuota. Il contenuto lo giudica chi legge.
 */
const asNumbers = (version: string) => version.split(".").map(Number);

describe("note di rilascio", () => {
  it("non si documenta una build che non esiste ancora (più di una avanti)", () => {
    /**
     * La nota si scrive PRIMA del deploy, con il numero che il deploy creerà
     * (l'ultimo +1): così la novità si legge nella build che la contiene.
     *
     * Quello che qui **non** si pretende è che la nota ci sia: pretenderlo ha
     * bloccato un rilascio vero (14/08/2026). `deploy.sh` alza la versione e
     * *poi* lancia i test, quindi subito dopo il bump l'applicazione è di una
     * versione avanti rispetto all'ultima nota — che è lo stato normale, non un
     * errore. E una riga di testo dimenticata non deve impedire di rilasciare
     * una correzione urgente: il promemoria sta in CLAUDE.md, non in un cancello.
     *
     * Resta il controllo che conta: non si racconta una build che non esiste.
     */
    const [newest] = RELEASE_NOTES;
    expect(newest).toBeDefined();
    const [notaMaggiore = 0, notaMinore = 0, notaBuild = 0] = asNumbers(newest!.version);
    const [appMaggiore = 0, appMinore = 0, appBuild = 0] = asNumbers(APP_VERSION);

    expect(notaMaggiore).toBe(appMaggiore);
    /**
     * **Il salto di minor si scrive prima.** Una funzione nuova non esce con un
     * numero di patch, e la si rilascia con `deploy.sh --set-version 0.11.0`:
     * ma la nota va scritta *prima*, perché è il deploy a creare quella build.
     * Fra la nota e il rilascio, quindi, l'applicazione è ancora un minor
     * indietro — ed è lo stato normale, non un errore (04/09/2026: ha fermato
     * un deploy vero).
     *
     * Quel che resta vietato è raccontare una build lontana: due minor avanti,
     * o dentro lo stesso minor più di una build avanti.
     */
    if (notaMinore === appMinore) {
      expect(notaBuild - appBuild).toBeLessThanOrEqual(1);
    } else if (notaMinore > appMinore) {
      expect(notaMinore - appMinore).toBe(1);
    }
    // Una nota INDIETRO (l'applicazione ha saltato un minor senza una nota
    // nuova) non racconta niente che non esista: è un promemoria, non un errore.
  });

  it("dalla più recente, senza doppioni", () => {
    const versions = RELEASE_NOTES.map((note) => note.version);
    expect(new Set(versions).size).toBe(versions.length);
    /**
     * Il confronto guarda tutti e tre i numeri, non solo l'ultimo.
     * Ordinando per il solo patch, `0.10.0` risultava più vecchia di `0.9.181`
     * — cosa che nessuno poteva vedere finché il minor non è cambiato mai, e
     * che al primo salto (22/08/2026) ha bloccato un rilascio.
     */
    const sorted = [...RELEASE_NOTES].sort((a, b) => {
      const [maggioreA = 0, minoreA = 0, patchA = 0] = asNumbers(a.version);
      const [maggioreB = 0, minoreB = 0, patchB = 0] = asNumbers(b.version);
      return maggioreB - maggioreA || minoreB - minoreA || patchB - patchA;
    });
    expect(versions).toEqual(sorted.map((note) => note.version));
  });

  it("the first community build has a note", () => {
    expect(RELEASE_NOTES.some((note) => note.version === PRIMA_VERSIONE_COMMUNITY)).toBe(true);
  });

  it("ogni voce ha una data valida e qualcosa da dire", () => {
    for (const note of RELEASE_NOTES) {
      expect(note.date, note.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(note.date)), note.version).toBe(false);
      expect(note.items.length, note.version).toBeGreaterThan(0);
      for (const item of note.items) expect(testoDellaVoce(item).trim().length).toBeGreaterThan(10);
    }
  });
});
