// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Testo descrittivo: com'è fatto e come si riduce a testo semplice.
 *
 * Le descrizioni si scrivono con un editor arricchito (grassetto, elenchi,
 * tabelle, immagini) e si salvano come **HTML** nello stesso campo di prima.
 * Il resto dell'applicazione però il testo lo vuole nudo: la ricerca, gli
 * estratti negli elenchi, le email, le notifiche. Da qui passa la traduzione,
 * una volta sola.
 *
 * Due regole che rendono il cambio indolore:
 *
 * 1. **Il vecchio testo semplice resta valido.** Nel database ci sono anni di
 *    descrizioni scritte a capo e basta: non si migrano. Chi legge riconosce
 *    cosa ha in mano (`looksLikeRichText`) e chi scrive le converte al primo
 *    salvataggio.
 * 2. **Il testo semplice è sempre ricavabile.** Nessuna funzione mostra HTML
 *    dove prima c'era testo: si chiama `richTextToPlain` e si va avanti.
 *
 * La ripulitura di ciò che arriva da fuori (incolla dal browser, dal
 * gestionale del cliente, da Word) sta invece sul server:
 * `modules/rich-text/sanitize.ts`. Qui dentro non si decide cosa è permesso —
 * si traduce e basta.
 */

/** Marcatori che distinguono l'HTML dal testo scritto a mano con `<` dentro. */
const RICH_TEXT_MARKER =
  /<\/?(p|div|br|ul|ol|li|h[1-6]|strong|b|em|i|u|s|a|table|thead|tbody|tr|td|th|img|blockquote|pre|code|span|hr)\b[^>]*>/i;

/**
 * Il valore salvato è HTML, o testo semplice di prima?
 *
 * Serve una prova positiva, non l'assenza di `<`: una descrizione può contenere
 * "se x < y" senza per questo essere HTML, e trattarla come tale la mangerebbe.
 */
export function looksLikeRichText(value: string | null | undefined): boolean {
  return !!value && RICH_TEXT_MARKER.test(value);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const value =
        code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) && value > 0 ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Da testo arricchito a testo semplice leggibile: quello che finisce nelle
 * email, negli estratti, nelle notifiche. Non è una ripulitura di sicurezza —
 * è una traduzione: la struttura diventa spaziatura.
 */
export function richTextToPlain(value: string | null | undefined): string {
  if (!value) return "";
  if (!looksLikeRichText(value)) return value;
  const text = value
    // Quello che sta dentro non è testo da leggere: via con tutto.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    // Le voci di elenco si riconoscono anche senza pallini veri.
    .replace(/<li\b[^>]*>/gi, "- ")
    // Le celle restano sulla stessa riga, separate; la riga finisce con <tr>.
    .replace(/<\/t[dh]>\s*/gi, "\t")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\t+\n/g, "\n");
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Testo che non può rompere il documento né iniettare marcatori. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Da testo semplice a HTML: serve all'editor quando apre una descrizione
 * scritta prima che esistesse. Una riga vuota separa i paragrafi, un ritorno a
 * capo singolo resta tale — è come lo si è scritto e come ci si aspetta di
 * rivederlo.
 */
export function plainToRichText(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (looksLikeRichText(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Il campo è vuoto? Un `<p></p>` lasciato dall'editor non è contenuto. */
export function isRichTextEmpty(value: string | null | undefined): boolean {
  if (!value) return true;
  // Un'immagine è contenuto anche senza una parola intorno.
  if (/<(img|table|hr)\b/i.test(value)) return false;
  return richTextToPlain(value).trim() === "";
}

/**
 * Aggiunge una nota **in fondo** a una descrizione, separata da una riga.
 *
 * Nasce dall'offerta vinta (19/08/2026): chi chiude la vendita sa qualcosa che
 * all'amministrazione serve — "fattura a 60 giorni", "il riferimento è
 * l'ufficio acquisti" — e finora quel qualcosa doveva riscriverlo altrove, o
 * non lo scriveva. La nota va in coda e non in cima perché la descrizione
 * originale è il contratto: si legge per prima, e il commento arriva dopo.
 *
 * La riga di separazione è un `<hr>`, che è il `---` di chi scrive: la
 * descrizione può essere HTML o testo semplice di anni fa, e mescolare i due
 * darebbe una nota fuori posto, quindi qui diventa tutto HTML — che è la forma
 * in cui l'editor risalverebbe comunque al primo tocco.
 */
export function appendNote(description: string | null | undefined, note: string): string {
  const testo = note.trim();
  const base = plainToRichText(description);
  if (!testo) return base;
  return base ? `${base}<hr>${plainToRichText(testo)}` : plainToRichText(testo);
}
