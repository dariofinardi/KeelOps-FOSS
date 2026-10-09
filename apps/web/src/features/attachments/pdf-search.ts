/**
 * **La ricerca nel lettore PDF**, senza DOM e senza pdf.js: testo in entrata,
 * posizioni in uscita (24/09/2026).
 *
 * pdf.js dà il testo di una pagina a pezzi — un pezzo per ogni corsa di testo
 * nello stesso carattere — e il livello di testo disegna uno `<span>` per
 * pezzo. Una parola cercata può stare a cavallo di due pezzi ("rilasc" +
 * "io"), quindi si cerca sul testo della pagina **cucito** e ogni
 * corrispondenza torna come elenco di tratti, uno per pezzo toccato: è quello
 * che serve per evidenziarla dentro gli span giusti.
 *
 * Il confronto ignora maiuscole e accenti ("citta" trova "Città"), carattere
 * per carattere, così le posizioni nel testo normalizzato sono le stesse del
 * testo originale.
 */

/** Un pezzo di testo di una pagina, come lo dà `getTextContent()`. */
export interface PdfTextItem {
  str: string;
  /** Fine riga dopo il pezzo: nel testo cucito diventa uno spazio. */
  hasEOL?: boolean;
}

/** Un tratto evidenziato: i caratteri `[da, a)` del pezzo `pezzo`. */
export interface PdfMatchPart {
  pezzo: number;
  da: number;
  a: number;
}

export interface PdfMatch {
  /** Numero della pagina, da 1. */
  pagina: number;
  parti: PdfMatchPart[];
}

/** Minuscolo e senza accenti, **stessa lunghezza** dell'originale. */
export function normalizzaPerRicerca(testo: string): string {
  let out = "";
  for (const c of testo) {
    const base = [...c.normalize("NFD")][0] ?? c;
    const lower = base.toLowerCase();
    // un carattere che in minuscolo cambia lunghezza ("İ") resta com'è
    out += lower.length === c.length ? lower : c;
  }
  return out;
}

/** Le corrispondenze di `cerca` in una pagina, in ordine. */
export function cercaInPagina(pezzi: PdfTextItem[], cerca: string, pagina: number): PdfMatch[] {
  const ago = normalizzaPerRicerca(cerca.trim().replace(/\s+/g, " "));
  if (!ago) return [];

  // il testo cucito, e da dove comincia ogni pezzo
  const inizi: number[] = [];
  let testo = "";
  for (const p of pezzi) {
    inizi.push(testo.length);
    testo += p.str;
    if (p.hasEOL) testo += " ";
  }
  const pagliaio = normalizzaPerRicerca(testo).replace(/\s/g, " ");

  const trovate: PdfMatch[] = [];
  let da = pagliaio.indexOf(ago);
  while (da !== -1) {
    const a = da + ago.length;
    const parti: PdfMatchPart[] = [];
    pezzi.forEach((p, i) => {
      const inizio = inizi[i]!;
      const fine = inizio + p.str.length;
      const s = Math.max(da, inizio);
      const e = Math.min(a, fine);
      if (s < e) parti.push({ pezzo: i, da: s - inizio, a: e - inizio });
    });
    // una corrispondenza fatta solo di fine riga non ha niente da evidenziare
    if (parti.length) trovate.push({ pagina, parti });
    da = pagliaio.indexOf(ago, a);
  }
  return trovate;
}

/** Tutte le corrispondenze del documento, pagina dopo pagina. */
export function cercaNelDocumento(pagine: PdfTextItem[][], cerca: string): PdfMatch[] {
  return pagine.flatMap((pezzi, i) => cercaInPagina(pezzi, cerca, i + 1));
}

/** L'indice dopo (o prima di) `corrente`, girando in tondo. */
export function giraIndice(corrente: number, totale: number, verso: 1 | -1): number {
  if (totale <= 0) return -1;
  if (corrente < 0) return verso === 1 ? 0 : totale - 1;
  return (corrente + verso + totale) % totale;
}

/** Il numero di pagina scritto a mano, riportato dentro il documento. */
export function paginaValida(scritta: number, totale: number): number {
  if (!Number.isFinite(scritta) || totale < 1) return 1;
  return Math.min(totale, Math.max(1, Math.round(scritta)));
}
