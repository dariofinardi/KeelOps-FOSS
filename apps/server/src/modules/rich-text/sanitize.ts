// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import sanitizeHtml from "sanitize-html";

/**
 * Cosa è ammesso dentro una descrizione.
 *
 * Le descrizioni arrivano da un editor che produce marcatori puliti, ma anche
 * da un **incolla**: una tabella copiata dal gestionale del cliente, un pezzo
 * di pagina web, un messaggio di Word. Lì dentro c'è di tutto, e finisce in un
 * campo che poi qualcun altro vedrà disegnato. Quindi si ripulisce **quando si
 * salva**, non quando si mostra: nel database ci va solo roba già buona, e chi
 * legge — oggi il pannello, domani un'esportazione o un'email — non deve
 * ricordarsi di difendersi.
 *
 * Che l'editor faccia già la sua parte non conta: le rotte accettano JSON da
 * chiunque abbia una sessione, e la ripulitura fatta solo nel browser è una
 * ripulitura che non c'è.
 *
 * Le regole della lista:
 * - **struttura e stile del testo sì** (titoli, elenchi, tabelle, grassetto):
 *   è quello che serve per scrivere una descrizione decente;
 * - **niente di eseguibile**: `script`, `style`, `iframe`, gestori `on*`, e
 *   nessun indirizzo `javascript:` — `sanitize-html` scarta gli schemi che non
 *   sono in elenco;
 * - **immagini solo nostre**: un `<img>` che punta fuori è un tracciatore che
 *   dice a un terzo chi ha aperto quel task e quando. Le figure incollate si
 *   caricano sul nostro server (vedi le rotte degli allegati) e restano lì.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "table",
  // colgroup/col: le tabelle ridimensionabili dell'editor portano le larghezze
  // qui, con l'attributo colwidth. Scartarle azzerava le colonne a ogni salvataggio.
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "span",
];

/** Immagini nostre: percorsi interni, oppure il contenuto già incorporato. */
const INTERNAL_IMAGE = /^\/(api|uploads)\//;

export const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    // `class` sull'immagine: l'editor la mette (max-w-full). Scartarla faceva
    // divergere il salvato dalla bozza, e l'autosave sparava un secondo PATCH.
    img: ["src", "alt", "title", "width", "height", "class"],
    col: ["colwidth", "style"],
    td: ["colspan", "rowspan", "colwidth"],
    th: ["colspan", "rowspan", "colwidth"],
    // Il colore del testo è l'unico stile che si porta dietro un senso;
    // il resto (font, sfondi, posizionamenti) lo decide il tema.
    span: ["style"],
    p: ["style"],
  },
  allowedStyles: {
    "*": { color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i], "background-color": [/^#[0-9a-f]{3,8}$/i] },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  // Un collegamento che si apre altrove non deve dare al sito di destinazione
  // il controllo della finestra da cui arriva.
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
  },
  exclusiveFilter: (frame) =>
    frame.tag === "img" && !INTERNAL_IMAGE.test(frame.attribs.src?.trim() ?? ""),
};

/**
 * Inizio di marcatore secondo la stessa regola dei browser: `<` **attaccato** a
 * una lettera (o a `/`, o a `!`). "va bene se x < y" non è marcatore per
 * nessuno, quindi non lo è nemmeno per noi e passa intatto: ripulire una frase
 * vorrebbe dire riscriverla di nascosto. "x <y" invece un browser lo
 * mangerebbe comunque, quindi trattarlo come marcatore è la lettura giusta.
 */
const TAG_START = /<[a-z!/]/i;

/** Ripulisce una descrizione in arrivo. Il testo semplice passa intatto. */
export function sanitizeRichText(value: string): string {
  if (!TAG_START.test(value)) return value;
  return sanitizeHtml(value, RICH_TEXT_OPTIONS);
}

/** Come sopra, ma accetta e restituisce il "campo assente". */
export function sanitizeRichTextOrNull<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" ? sanitizeRichText(value) : value) as T;
}
