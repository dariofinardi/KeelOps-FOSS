// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  Search,
} from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Button } from "@/components/ui/button";
import {
  cercaNelDocumento,
  giraIndice,
  paginaValida,
  type PdfMatch,
  type PdfTextItem,
} from "./pdf-search";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/** Il livello di testo disegnato di una pagina: gli span e il testo di ciascuno. */
interface TestoPagina {
  spans: HTMLElement[];
  pezzi: PdfTextItem[];
}

/**
 * I pezzi di testo di una pagina, **uno per span** del livello di testo: pdf.js
 * crea uno span per ogni elemento con `str` e salta i marcatori di contenuto,
 * quindi si saltano anche qui — o gli indici della ricerca finiscono sullo
 * span sbagliato.
 */
function pezziDi(items: readonly object[]): PdfTextItem[] {
  return items.flatMap((item) =>
    "str" in item && typeof item.str === "string"
      ? [{ str: item.str, hasEOL: "hasEOL" in item && item.hasEOL === true }]
      : [],
  );
}

/** La scala che fa stare la pagina più larga nel pannello, senza superare 1,6. */
function scalaPer(radice: HTMLElement | null, misure: { w: number }[]): number {
  const larghezza = (radice?.clientWidth ?? 800) - 32;
  return Math.max(0.2, Math.min(1.6, larghezza / Math.max(...misure.map((m) => m.w))));
}

/**
 * **Il lettore PDF**: le pagine una sotto l'altra, e sopra una barra essenziale
 * — prima, precedente, «pagina N di M», successiva, ultima — e la ricerca nel
 * testo, con le parole trovate evidenziate e il conto dei risultati
 * (24/09/2026).
 *
 * Usa la build **legacy** di pdf.js. Quella moderna chiama funzioni di
 * JavaScript uscite da pochi mesi (`Map.prototype.getOrInsertComputed`), e un
 * cliente del portale con un browser di un anno fa vedeva solo
 * «getOrInsertComputed is not a function» al posto delle note di rilascio. La
 * legacy porta con sé i polyfill; costa qualche decina di KB, e solo a chi apre
 * un PDF.
 *
 * Le pagine si disegnano **quando stanno per entrare nella vista**: un manuale
 * di duecento pagine si apre subito, e la memoria resta quella delle pagine
 * guardate. Le misure di tutte si leggono all'apertura, così la barra di
 * scorrimento è giusta da subito e «ultima pagina» porta davvero in fondo.
 */
export function PdfViewer({ url }: { url: string }) {
  const { t } = useTranslation();
  const scorreRef = useRef<HTMLDivElement>(null);
  const pagineRef = useRef<(HTMLDivElement | null)[]>([]);
  const [documento, setDocumento] = useState<{
    pdf: PDFDocumentProxy;
    pdfjs: PdfJs;
    misure: { w: number; h: number }[];
    scala: number;
  } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [paginaScritta, setPaginaScritta] = useState("1");

  const [cerca, setCerca] = useState("");
  const [trovate, setTrovate] = useState<PdfMatch[]>([]);
  const [attuale, setAttuale] = useState(-1);
  const [cercando, setCercando] = useState(false);

  // ciò che il disegno imperativo deve leggere senza ridisegnare React
  const disegnate = useRef(new Map<number, Promise<TestoPagina | null>>());
  const testi = useRef(new Map<number, Promise<PdfTextItem[]>>());
  const trovateRef = useRef<PdfMatch[]>([]);
  // la pagina corrente, e quella su cui tornare dopo un cambio di scala
  const paginaRef = useRef(1);
  const tornaA = useRef<number | null>(null);
  const attualeRef = useRef(-1);

  /* ── apertura ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    let annullato = false;
    let caricamento: PDFDocumentLoadingTask | null = null;
    setDocumento(null);
    setErrore(null);
    disegnate.current = new Map();
    testi.current = new Map();
    void (async () => {
      try {
        const risposta = await fetch(url, { credentials: "same-origin" });
        if (!risposta.ok) throw new Error(t("Documento non disponibile"));
        const dati = await risposta.arrayBuffer();
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        // Il worker viaggia col resto della build: nessuna richiesta a CDN
        // esterni (la politica di sicurezza dell'applicazione le blocca).
        const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        caricamento = pdfjs.getDocument({ data: dati });
        const pdf = await caricamento.promise;
        const misure: { w: number; h: number }[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const vista = (await pdf.getPage(n)).getViewport({ scale: 1 });
          misure.push({ w: vista.width, h: vista.height });
        }
        if (annullato) return;
        setDocumento({ pdf, pdfjs, misure, scala: scalaPer(scorreRef.current, misure) });
        setPagina(1);
        setPaginaScritta("1");
      } catch (err) {
        if (!annullato) setErrore(err instanceof Error ? err.message : t("Lettura non riuscita"));
      }
    })();
    return () => {
      annullato = true;
      // chiude il documento e il suo worker
      void caricamento?.destroy();
    };
  }, [url, t]);

  /* ── evidenziare ──────────────────────────────────────────────────────── */
  const evidenzia = useCallback((numero: number, testo: TestoPagina) => {
    // si riparte dal testo nudo: lo span di pdf.js ha la sua larghezza già
    // calcolata sul testo intero, e noi ci cuciamo dentro, senza toccarlo
    testo.spans.forEach((span, i) => {
      if (span.firstElementChild) span.textContent = testo.pezzi[i]?.str ?? "";
    });
    const perPezzo = new Map<number, { da: number; a: number; attuale: boolean }[]>();
    trovateRef.current.forEach((m, indice) => {
      if (m.pagina !== numero) return;
      for (const parte of m.parti) {
        const elenco = perPezzo.get(parte.pezzo) ?? [];
        elenco.push({ da: parte.da, a: parte.a, attuale: indice === attualeRef.current });
        perPezzo.set(parte.pezzo, elenco);
      }
    });
    for (const [pezzo, tratti] of perPezzo) {
      const span = testo.spans[pezzo];
      const str = testo.pezzi[pezzo]?.str ?? "";
      if (!span) continue;
      span.textContent = "";
      let fino = 0;
      for (const tratto of tratti.sort((x, y) => x.da - y.da)) {
        if (tratto.da > fino) span.append(str.slice(fino, tratto.da));
        const segno = document.createElement("span");
        segno.className = tratto.attuale ? "pdf-trovato pdf-attuale" : "pdf-trovato";
        segno.textContent = str.slice(tratto.da, tratto.a);
        span.append(segno);
        fino = tratto.a;
      }
      if (fino < str.length) span.append(str.slice(fino));
    }
  }, []);

  /* ── disegnare una pagina ─────────────────────────────────────────────── */
  const disegna = useCallback(
    (numero: number): Promise<TestoPagina | null> => {
      const gia = disegnate.current.get(numero);
      if (gia) return gia;
      const lavoro = (async () => {
        const host = pagineRef.current[numero - 1];
        if (!documento || !host) return null;
        const { pdf, pdfjs, scala } = documento;
        const p = await pdf.getPage(numero);
        const vista = p.getViewport({ scale: scala });
        // nitida sugli schermi densi, ma non oltre il doppio: la memoria di
        // un canvas cresce col quadrato
        const densita = Math.min(2, window.devicePixelRatio || 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vista.width * densita);
        canvas.height = Math.floor(vista.height * densita);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.className = "block";
        host.replaceChildren(canvas);
        await p.render({
          canvas,
          viewport: vista,
          transform: densita === 1 ? undefined : [densita, 0, 0, densita, 0, 0],
        }).promise;

        const contenuto = await p.getTextContent();
        testi.current.set(numero, Promise.resolve(pezziDi(contenuto.items)));
        const livello = document.createElement("div");
        livello.className = "pdf-testo";
        livello.setAttribute("aria-hidden", "true");
        host.append(livello);
        const strato = new pdfjs.TextLayer({
          textContentSource: contenuto,
          container: livello,
          viewport: vista,
        });
        await strato.render();
        const testo = {
          spans: strato.textDivs,
          pezzi: strato.textContentItemsStr.map((str) => ({ str })),
        };
        evidenzia(numero, testo);
        return testo;
      })().catch(() => {
        disegnate.current.delete(numero);
        return null;
      });
      disegnate.current.set(numero, lavoro);
      return lavoro;
    },
    [documento, evidenzia],
  );

  // Il pannello si allarga o si stringe (il telefono si gira, la finestra
  // cambia): la scala si ricalcola e le pagine si ridisegnano, quelle in vista
  // subito e le altre quando ci si arriva. Sotto il 2% di differenza non vale
  // il ridisegno.
  useEffect(() => {
    const radice = scorreRef.current;
    if (!documento || !radice) return;
    let attesa = 0;
    const osservatore = new ResizeObserver(() => {
      window.clearTimeout(attesa);
      attesa = window.setTimeout(() => {
        const scala = scalaPer(radice, documento.misure);
        if (Math.abs(scala - documento.scala) / documento.scala < 0.02) return;
        disegnate.current = new Map();
        tornaA.current = paginaRef.current;
        setDocumento({ ...documento, scala });
      }, 200);
    });
    osservatore.observe(radice);
    return () => {
      window.clearTimeout(attesa);
      osservatore.disconnect();
    };
  }, [documento]);

  // le pagine si disegnano quando si avvicinano alla vista
  useEffect(() => {
    const radice = scorreRef.current;
    if (!documento || !radice) return;
    const osservatore = new IntersectionObserver(
      (voci) => {
        for (const voce of voci) {
          if (voce.isIntersecting)
            void disegna(Number((voce.target as HTMLElement).dataset.pagina));
        }
      },
      { root: radice, rootMargin: "800px 0px" },
    );
    for (const el of pagineRef.current) if (el) osservatore.observe(el);
    return () => osservatore.disconnect();
  }, [documento, disegna]);

  /* ── dove siamo, e andare altrove ─────────────────────────────────────── */
  const aggiornaPagina = useCallback(() => {
    const radice = scorreRef.current;
    if (!radice) return;
    // la pagina corrente è l'ultima il cui bordo alto sta sopra un terzo della vista
    const soglia = radice.scrollTop + radice.clientHeight / 3;
    let corrente = 1;
    pagineRef.current.forEach((el, i) => {
      if (el && el.offsetTop <= soglia) corrente = i + 1;
    });
    // in fondo al documento l'ultima pagina, anche se è corta e non sale fin lì
    if (radice.scrollTop > 0 && radice.scrollTop + radice.clientHeight >= radice.scrollHeight - 2) {
      corrente = pagineRef.current.length;
    }
    paginaRef.current = corrente;
    setPagina(corrente);
    setPaginaScritta(String(corrente));
  }, []);

  const vaiA = useCallback((numero: number) => {
    const radice = scorreRef.current;
    const el = pagineRef.current[numero - 1];
    if (!radice || !el) return;
    radice.scrollTop = el.offsetTop - 16;
    paginaRef.current = numero;
    setPagina(numero);
    setPaginaScritta(String(numero));
  }, []);

  // dopo un cambio di scala le pagine hanno altre misure: si torna dov'eravamo
  useEffect(() => {
    if (tornaA.current === null) return;
    vaiA(tornaA.current);
    tornaA.current = null;
  }, [documento, vaiA]);

  const totale = documento?.pdf.numPages ?? 0;

  /* ── cercare ──────────────────────────────────────────────────────────── */
  const mostraTrovata = useCallback(
    async (indice: number) => {
      attualeRef.current = indice;
      setAttuale(indice);
      const m = trovateRef.current[indice];
      // si ridisegna l'evidenziazione delle pagine già pronte: la trovata
      // attuale cambia colore, la precedente torna gialla
      for (const [numero, lavoro] of disegnate.current) {
        const testo = await lavoro;
        if (testo) evidenzia(numero, testo);
      }
      if (!m) return;
      vaiA(m.pagina);
      const testo = await disegna(m.pagina);
      if (!testo) return;
      const segno = pagineRef.current[m.pagina - 1]?.querySelector<HTMLElement>(".pdf-attuale");
      const radice = scorreRef.current;
      if (segno && radice) {
        const pag = pagineRef.current[m.pagina - 1]!;
        const alto =
          pag.offsetTop + segno.getBoundingClientRect().top - pag.getBoundingClientRect().top;
        radice.scrollTop = Math.max(0, alto - radice.clientHeight / 3);
      }
    },
    [disegna, evidenzia, vaiA],
  );

  // La ricerca dipende dal documento e dalla parola, **non dalla scala**: un
  // cambio di larghezza ridisegna le pagine ma non deve riportare al primo
  // risultato. Per questo la funzione che mostra un risultato si legge da un
  // riferimento, sempre l'ultima.
  const mostraRef = useRef(mostraTrovata);
  useEffect(() => {
    mostraRef.current = mostraTrovata;
  }, [mostraTrovata]);
  const pdf = documento?.pdf;

  useEffect(() => {
    if (!pdf) return;
    const parola = cerca.trim();
    let annullato = false;
    const attesa = window.setTimeout(() => {
      void (async () => {
        if (!parola) {
          trovateRef.current = [];
          setTrovate([]);
          await mostraRef.current(-1);
          return;
        }
        setCercando(true);
        const pagine: PdfTextItem[][] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          let testo = testi.current.get(n);
          if (!testo) {
            testo = pdf
              .getPage(n)
              .then((p) => p.getTextContent())
              .then((c) => pezziDi(c.items));
            testi.current.set(n, testo);
          }
          pagine.push(await testo);
          if (annullato) return;
        }
        const risultati = cercaNelDocumento(pagine, parola);
        trovateRef.current = risultati;
        setTrovate(risultati);
        setCercando(false);
        await mostraRef.current(risultati.length ? 0 : -1);
      })();
    }, 250);
    return () => {
      annullato = true;
      window.clearTimeout(attesa);
    };
  }, [cerca, pdf]);

  const trovataDopo = (verso: 1 | -1) => {
    const indice = giraIndice(attualeRef.current, trovateRef.current.length, verso);
    if (indice >= 0) void mostraTrovata(indice);
  };

  /* ── disegno ──────────────────────────────────────────────────────────── */
  const bottone = "size-10 sm:size-8";
  return (
    <div className="flex h-full flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5 text-sm">
        <Button
          variant="ghost"
          size="icon"
          className={bottone}
          title={t("Prima pagina")}
          aria-label={t("Prima pagina")}
          disabled={!totale || pagina <= 1}
          onClick={() => vaiA(1)}
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={bottone}
          title={t("Pagina precedente")}
          aria-label={t("Pagina precedente")}
          disabled={!totale || pagina <= 1}
          onClick={() => vaiA(pagina - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <form
          className="flex items-center gap-1 tabular-nums"
          onSubmit={(e) => {
            e.preventDefault();
            vaiA(paginaValida(Number(paginaScritta), totale));
          }}
        >
          <input
            value={paginaScritta}
            inputMode="numeric"
            aria-label={t("Numero di pagina")}
            disabled={!totale}
            onChange={(e) => setPaginaScritta(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setPaginaScritta(String(pagina))}
            className="h-8 w-12 rounded border bg-background px-1 text-center text-base sm:text-sm"
          />
          <span className="whitespace-nowrap text-muted-foreground">
            {t("di {{n}}", { n: totale || "…" })}
          </span>
        </form>
        <Button
          variant="ghost"
          size="icon"
          className={bottone}
          title={t("Pagina successiva")}
          aria-label={t("Pagina successiva")}
          disabled={!totale || pagina >= totale}
          onClick={() => vaiA(pagina + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={bottone}
          title={t("Ultima pagina")}
          aria-label={t("Ultima pagina")}
          disabled={!totale || pagina >= totale}
          onClick={() => vaiA(totale)}
        >
          <ChevronsRight className="size-4" />
        </Button>

        <div className="ml-auto flex min-w-0 items-center gap-1">
          <label className="flex min-w-0 items-center gap-1 rounded border bg-background px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="search"
              value={cerca}
              placeholder={t("Cerca nel documento")}
              aria-label={t("Cerca nel documento")}
              data-no-autofocus
              disabled={!totale}
              onChange={(e) => setCerca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  trovataDopo(e.shiftKey ? -1 : 1);
                }
              }}
              className="h-8 w-32 min-w-0 bg-transparent text-base outline-none sm:w-44 sm:text-sm"
            />
          </label>
          {cerca.trim() && !cercando && (
            <span
              className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {trovate.length
                ? t("{{i}} di {{n}}", { i: attuale + 1, n: trovate.length })
                : t("Nessun risultato")}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={bottone}
            title={t("Risultato precedente")}
            aria-label={t("Risultato precedente")}
            disabled={!trovate.length}
            onClick={() => trovataDopo(-1)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={bottone}
            title={t("Risultato successivo")}
            aria-label={t("Risultato successivo")}
            disabled={!trovate.length}
            onClick={() => trovataDopo(1)}
          >
            <ChevronDown className="size-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scorreRef}
        onScroll={aggiornaPagina}
        className="relative min-h-0 flex-1 overflow-auto p-4"
      >
        {!documento && !errore && (
          <p className="p-4 text-center text-sm text-muted-foreground">{t("Apro il documento…")}</p>
        )}
        {errore && <p className="p-4 text-center text-sm text-destructive">{errore}</p>}
        {documento?.misure.map((m, i) => (
          <div
            key={i}
            ref={(el) => {
              pagineRef.current[i] = el;
            }}
            data-pagina={i + 1}
            className="relative mx-auto mb-3 max-w-none overflow-hidden rounded border bg-white shadow-sm"
            style={
              {
                width: m.w * documento.scala,
                height: m.h * documento.scala,
                "--total-scale-factor": documento.scala,
                "--scale-round-x": "1px",
                "--scale-round-y": "1px",
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
