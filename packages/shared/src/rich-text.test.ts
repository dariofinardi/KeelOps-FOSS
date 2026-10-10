// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  appendNote,
  isRichTextEmpty,
  looksLikeRichText,
  plainToRichText,
  richTextToPlain,
} from "./rich-text";

describe("riconoscere il testo arricchito", () => {
  it("distingue l'HTML dal testo scritto a mano", () => {
    expect(looksLikeRichText("<p>ciao</p>")).toBe(true);
    expect(looksLikeRichText("ciao")).toBe(false);
    // Il caso che conta: una descrizione tecnica non è HTML solo perché ha un <.
    expect(looksLikeRichText("va bene se x < y e y > z")).toBe(false);
    expect(looksLikeRichText("")).toBe(false);
    expect(looksLikeRichText(null)).toBe(false);
  });
});

describe("da testo arricchito a testo semplice", () => {
  it("la struttura diventa spaziatura", () => {
    expect(richTextToPlain("<p>Prima riga</p><p>Seconda riga</p>")).toBe(
      "Prima riga\nSeconda riga",
    );
    expect(richTextToPlain("<p>Uno<br>Due</p>")).toBe("Uno\nDue");
  });

  it("gli elenchi restano riconoscibili", () => {
    expect(richTextToPlain("<ul><li>Uno</li><li>Due</li></ul>")).toBe("- Uno\n- Due");
  });

  it("le tabelle diventano righe e colonne separate", () => {
    const html =
      "<table><tr><td>Voce</td><td>Importo</td></tr><tr><td>Canone</td><td>90</td></tr></table>";
    expect(richTextToPlain(html)).toBe("Voce\tImporto\nCanone\t90");
  });

  it("i caratteri speciali tornano com'erano", () => {
    expect(richTextToPlain("<p>Costi &amp; ricavi &lt; 100 &nbsp;&#8364;</p>")).toBe(
      "Costi & ricavi < 100  €",
    );
  });

  it("il testo semplice di prima passa intatto", () => {
    // Nel database ci sono anni di descrizioni così: non si toccano.
    const vecchio = "Chiamare il cliente\nchiedere del referente";
    expect(richTextToPlain(vecchio)).toBe(vecchio);
  });

  it("non lascia passare quello che non è testo da leggere", () => {
    expect(richTextToPlain("<p>Ciao</p><script>alert(1)</script>")).toBe("Ciao");
  });

  it("non lascia righe vuote a grappoli", () => {
    expect(richTextToPlain("<p>Uno</p><p></p><p></p><p>Due</p>")).toBe("Uno\n\nDue");
  });
});

describe("da testo semplice a testo arricchito", () => {
  it("le righe vuote separano i paragrafi, i ritorni a capo restano", () => {
    expect(plainToRichText("Uno\nDue\n\nTre")).toBe("<p>Uno<br>Due</p><p>Tre</p>");
  });

  it("il testo dell'utente non diventa marcatore", () => {
    expect(plainToRichText("se x < y & y > z")).toBe("<p>se x &lt; y &amp; y &gt; z</p>");
  });

  it("quello che è già arricchito non si riconverte", () => {
    expect(plainToRichText("<p>già così</p>")).toBe("<p>già così</p>");
    expect(plainToRichText("   ")).toBe("");
  });
});

describe("campo vuoto", () => {
  it("il paragrafo vuoto che lascia l'editor non è contenuto", () => {
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("<p><br></p>")).toBe(true);
    expect(isRichTextEmpty("")).toBe(true);
  });

  it("un'immagine o una tabella sono contenuto anche senza parole", () => {
    expect(isRichTextEmpty('<p><img src="/api/x.png"></p>')).toBe(false);
    expect(isRichTextEmpty("<table><tr><td></td></tr></table>")).toBe(false);
    expect(isRichTextEmpty("<p>testo</p>")).toBe(false);
  });
});

describe("la nota in coda a una descrizione", () => {
  it("va in fondo, dopo una riga di separazione", () => {
    expect(appendNote("<p>Contratto firmato</p>", "Fattura a 60 giorni")).toBe(
      "<p>Contratto firmato</p><hr><p>Fattura a 60 giorni</p>",
    );
  });

  it("una descrizione di testo semplice diventa HTML, invece di mescolarsi", () => {
    // Nel database ci sono anni di descrizioni scritte a capo e basta:
    // attaccarci dell'HTML lascerebbe la nota fuori posto.
    expect(appendNote("Prima riga\nSeconda", "Nota")).toBe(
      "<p>Prima riga<br>Seconda</p><hr><p>Nota</p>",
    );
  });

  it("senza descrizione la nota sta da sola, senza riga vuota davanti", () => {
    expect(appendNote(null, "Solo la nota")).toBe("<p>Solo la nota</p>");
  });

  it("una nota vuota non lascia una riga di separazione appesa", () => {
    expect(appendNote("<p>Contratto</p>", "   ")).toBe("<p>Contratto</p>");
  });
});
