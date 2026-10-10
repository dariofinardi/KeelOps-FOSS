// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { catalogs } from "./index";

/**
 * L'inglese è la lingua di riferimento (il default del prodotto): è il catalogo
 * più completo, e si procede "lingua per lingua" riempiendo poi fr/de/es. Il
 * test non pretende quindi che le quattro lingue siano identiche, ma garantisce
 * che nessuna abbia una voce **orfana** (una chiave che in inglese non esiste —
 * di solito un refuso) o una traduzione **vuota**. Le chiavi che a una lingua
 * mancano ricadono sull'italiano, che è la chiave stessa.
 */
describe("cataloghi di traduzione", () => {
  const enKeys = new Set(Object.keys(catalogs.en));

  for (const lang of ["fr", "de", "es"] as const) {
    it(`${lang}: nessuna chiave orfana rispetto all'inglese`, () => {
      const orphans = Object.keys(catalogs[lang]).filter((k) => !enKeys.has(k));
      expect(orphans, `chiavi in ${lang} assenti da en`).toEqual([]);
    });
  }

  it("nessuna traduzione è vuota", () => {
    for (const lang of ["en", "fr", "de", "es"] as const) {
      for (const [key, value] of Object.entries(catalogs[lang])) {
        expect(value.trim(), `${lang}: la voce "${key}" è vuota`).not.toBe("");
      }
    }
  });
});

/**
 * **Che una stringa sia davvero tradotta si vede solo chiedendolo a i18next.**
 *
 * I test qui sopra guardano i cataloghi come file: nessuna chiave orfana,
 * nessun valore vuoto. Non dicono che la ricerca funzioni — e le chiavi di
 * questo prodotto sono frasi italiane, con dentro punti e due punti, cioè
 * proprio i caratteri che i18next usa per separare gerarchie e namespace (291
 * chiavi su 2044 contengono i due punti). Qui si passa dall'istanza vera,
 * quella configurata in `lib/i18n.ts`, e le si chiede la frase in ogni lingua.
 *
 * Nota per chi verrà: questo NON è una rete sotto `nsSeparator: false`. Provato
 * il 02/09/2026 togliendo l'opzione, e la ricerca continua a riuscire —
 * l'istanza dell'applicazione trova la chiave intera prima di provare a
 * spezzarla. Su un'istanza nuda invece si rompe («per dati riservati» soltanto),
 * quindi l'opzione serve: semplicemente non è questo il test che la difende.
 */
describe("una frase con i due punti si traduce davvero", () => {
  const conDuePunti = "il testo viene cifrato: per dati riservati";

  it("in inglese, francese, tedesco e spagnolo — e in italiano resta la chiave", async () => {
    const i18n = (await import("../lib/i18n")).default;
    const prima = i18n.language;
    try {
      for (const lingua of ["en", "fr", "de", "es"] as const) {
        const atteso = catalogs[lingua][conDuePunti];
        expect(atteso, `manca in ${lingua}`).toBeTruthy();
        await i18n.changeLanguage(lingua);
        expect(i18n.t(conDuePunti)).toBe(atteso);
      }
      // In italiano non c'è catalogo: la chiave È la frase, e torna intera.
      await i18n.changeLanguage("it");
      expect(i18n.t(conDuePunti)).toBe(conDuePunti);
    } finally {
      await i18n.changeLanguage(prima);
    }
  });
});
