// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { sanitizeRichText, sanitizeRichTextOrNull } from "../src/modules/rich-text/sanitize";

describe("ripulitura delle descrizioni", () => {
  it("lascia passare quello che serve per scrivere", () => {
    const html =
      "<p><strong>Consegna</strong> entro il <em>15</em></p><ul><li>beta</li></ul>" +
      "<table><tr><th>Voce</th><td>90</td></tr></table>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("butta via tutto ciò che è eseguibile", () => {
    expect(sanitizeRichText("<p>Ciao</p><script>alert(1)</script>")).toBe("<p>Ciao</p>");
    expect(sanitizeRichText('<p onclick="alert(1)">Ciao</p>')).toBe("<p>Ciao</p>");
    expect(sanitizeRichText('<a href="javascript:alert(1)">clicca</a>')).toBe(
      '<a rel="noopener noreferrer nofollow">clicca</a>',
    );
    expect(sanitizeRichText('<iframe src="https://esempio.it"></iframe>')).toBe("");
  });

  it("le immagini sono solo le nostre", () => {
    // Un <img> remoto in una descrizione è un tracciatore: dice a un terzo chi
    // ha aperto quel task e quando. Le figure incollate si caricano da noi.
    expect(sanitizeRichText('<p><img src="https://tracciatore.it/pixel.gif"></p>')).toBe("<p></p>");
    expect(sanitizeRichText('<p><img src="/api/tasks/t1/inline/foto.png" alt="foto"></p>')).toBe(
      '<p><img src="/api/tasks/t1/inline/foto.png" alt="foto" /></p>',
    );
  });

  it("i collegamenti esterni non prendono il controllo della finestra", () => {
    expect(sanitizeRichText('<a href="https://esempio.it" target="_blank">sito</a>')).toContain(
      'rel="noopener noreferrer nofollow"',
    );
  });

  it("il testo semplice non diventa HTML di nascosto", () => {
    // Le descrizioni di prima sono testo e restano testo, anche con un < dentro.
    expect(sanitizeRichText("Chiamare il cliente\ne chiedere del referente")).toBe(
      "Chiamare il cliente\ne chiedere del referente",
    );
    // "< y" staccato non è un marcatore per nessuno, browser compresi.
    expect(sanitizeRichText("va bene se x < y")).toBe("va bene se x < y");
  });

  it("il campo assente resta assente", () => {
    expect(sanitizeRichTextOrNull(null)).toBeNull();
    expect(sanitizeRichTextOrNull(undefined)).toBeUndefined();
    expect(sanitizeRichTextOrNull("<p>ciao</p>")).toBe("<p>ciao</p>");
  });
});

describe("l'editor non si vede scartare il proprio markup", () => {
  it("conserva class su un'immagine nostra e le larghezze di colonna", () => {
    // Il difetto: l'allow-list scartava class su img e colgroup/col colwidth —
    // markup che TipTap emette sempre — quindi il salvato non coincideva con la
    // bozza e l'autosave sparava un secondo PATCH, azzerando le colonne.
    const html =
      '<p><img src="/api/tasks/t1/inline/f.png" class="max-w-full" alt="x"></p>' +
      '<table><colgroup><col colwidth="120"></colgroup><tr><td>a</td></tr></table>';
    const pulito = sanitizeRichText(html);
    expect(pulito).toContain('class="max-w-full"');
    expect(pulito).toContain('colwidth="120"');
    expect(pulito).toContain("<colgroup>");
  });
});
