import { useEffect, useRef, useState } from "react";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { viewableKind } from "@kancrm/shared";
import { PdfViewer } from "./PdfViewer";

/**
 * Lettore interno dei documenti — PDF, Word, immagini, video, audio, fogli di
 * calcolo, testo, Markdown e codice sorgente — disegnati nel browser senza
 * passare da un programma esterno e **senza salvare il file**.
 *
 * Serve ai monitor vendite, che possono consultare i documenti di un'offerta ma non
 * portarseli via. È bene essere onesti su cosa questo garantisce: per disegnare
 * una pagina i byte devono comunque arrivare al browser, quindi non è una
 * cassaforte. Quello che fa è togliere il salvataggio dalle azioni offerte — niente
 * comando di download, niente menu del lettore PDF del browser — e servire il file
 * *inline*, così un clic distratto non lo mette nella cartella dei download.
 *
 * Le librerie (pdf.js, docx-preview, SheetJS, marked, highlight.js) pesano: si
 * caricano **solo qui**, con un import dinamico, e non entrano nel resto
 * dell'applicazione — chi apre un PDF non paga il costo del lettore di fogli.
 *
 * **Il contenuto di un allegato è testo di qualcun altro**, e i tre lettori
 * nuovi lo trattano come tale: il foglio e il testo si disegnano costruendo
 * nodi DOM con `textContent` (nessun `innerHTML`, quindi niente da ripulire),
 * il codice lo scrive `highlight.js`, che l'HTML lo produce già scappato, e il
 * Markdown è l'unico che genera HTML — lì l'HTML grezzo dentro il documento si
 * butta e gli indirizzi dei collegamenti si ricontrollano a mano dopo il
 * disegno. `sanitize-html` vive sul server e portarlo nel browser per questo
 * solo caso sarebbe mezzo megabyte per un file di note.
 */
export function AttachmentViewer({
  url,
  name,
  mimeType,
  mode = "viewer",
}: {
  url: string;
  name: string;
  mimeType: string | null;
  /**
   * "drive-preview": link Google Workspace mostrato con l'anteprima `/preview`
   * di Google in un iframe — stesso pannello, altro disegnatore. Chi può vedere
   * il documento lo decide comunque l'ACL di Google dentro l'iframe.
   */
  mode?: "viewer" | "drive-preview";
}) {
  const { t } = useTranslation();
  const kind = mode === "drive-preview" ? null : viewableKind(mimeType, name);
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let annullato = false;
    const host = hostRef.current;
    // Immagini, video e audio li disegna (e li scarica) il **browser**: tirarli
    // giù con `fetch` in un arrayBuffer vorrebbe dire aspettare tutto il file
    // prima di vedere il primo fotogramma, e tenersi in memoria un filmato.
    // Il PDF ha il suo lettore, con la sua barra (`PdfViewer`).
    if (
      !host ||
      kind === null ||
      kind === "pdf" ||
      kind === "image" ||
      kind === "video" ||
      kind === "audio"
    ) {
      setLoading(false);
      return;
    }
    host.replaceChildren();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const risposta = await fetch(url, { credentials: "same-origin" });
        if (!risposta.ok) throw new Error(t("Documento non disponibile"));
        const dati = await risposta.arrayBuffer();
        if (annullato) return;

        if (kind === "docx") {
          const { renderAsync } = await import("docx-preview");
          if (annullato) return;
          await renderAsync(dati, host, undefined, {
            className: "docx",
            inWrapper: true,
            breakPages: true,
          });
        } else if (kind === "sheet") {
          await renderSheet(dati, host, () => annullato);
        } else if (kind === "markdown") {
          await renderMarkdown(dati, host);
        } else if (kind === "code") {
          await renderCode(dati, host, name);
        } else {
          renderText(dati, host);
        }
      } catch (err) {
        if (!annullato) setError(err instanceof Error ? err.message : t("Lettura non riuscita"));
      } finally {
        if (!annullato) setLoading(false);
      }
    })();

    return () => {
      annullato = true;
    };
  }, [url, kind, name, t]);

  if (mode === "drive-preview") {
    // L'anteprima la disegna Google dentro l'iframe (variante `/preview`,
    // pensata per l'incorporo): niente librerie da caricare, e l'accesso al
    // documento resta governato dall'ACL di Google — chi non è autorizzato lì
    // vede la richiesta di accesso, non il contenuto.
    return <iframe src={url} title={name} className="h-full w-full border-0 bg-muted/30" />;
  }

  if (kind === null) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        {t("Questo formato non si può leggere qui. Chiedi il documento al tuo referente.")}
      </p>
    );
  }

  if (kind === "pdf") return <PdfViewer url={url} />;

  return (
    <div className="h-full overflow-auto bg-muted/30 p-4">
      {loading && (
        <p className="p-4 text-center text-sm text-muted-foreground">{t("Apro il documento…")}</p>
      )}
      {error && <p className="p-4 text-center text-sm text-destructive">{error}</p>}
      {kind === "image" ? (
        // Le immagini le disegna il browser: nessuna libreria da caricare.
        <img
          src={url}
          alt={name}
          className="mx-auto max-w-full rounded border shadow-sm"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(t("Immagine non disponibile"));
          }}
        />
      ) : kind === "video" ? (
        // Lettore del browser, con i controlli: si guarda una registrazione
        // dello schermo senza scaricarla e senza un programma esterno. Lo
        // scorrimento nella barra funziona perché il server risponde alle
        // richieste parziali (`Range`), vedi attachments/routes.
        <video
          src={url}
          controls
          preload="metadata"
          className="mx-auto max-h-full max-w-full rounded border bg-black shadow-sm"
          onLoadedMetadata={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(t("Video non riproducibile"));
          }}
        />
      ) : kind === "audio" ? (
        <audio
          src={url}
          controls
          preload="metadata"
          className="mx-auto w-full max-w-xl"
          onLoadedMetadata={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(t("Audio non riproducibile"));
          }}
        />
      ) : (
        <div ref={hostRef} />
      )}
    </div>
  );
}

/* ── i lettori dei formati testuali ─────────────────────────────────────── */

/** I byte in testo. UTF-8 con `fatal: false`: un file in un'altra codifica si
 * legge storto ma si legge — meglio di un errore su un log di sistema. */
const decode = (dati: ArrayBuffer) => new TextDecoder("utf-8").decode(dati);

/**
 * **Foglio di calcolo**: ogni foglio diventa una tabella.
 *
 * Legge con **SheetJS** e non con `exceljs`, che pure è già in casa lato
 * server: il pacchetto di exceljs punta i browser su un bundle UMD che, caricato
 * da Vite, arriva con una forma diversa e si rompe alla prima lettura —
 * "Cannot read properties of undefined (reading 'sheets')" (18/08/2026).
 * SheetJS nasce per il browser, prende un `ArrayBuffer` così com'è e non
 * chiede polyfill di `Buffer` o `stream`.
 *
 * La tabella la costruisco a mano, cella per cella, con `textContent` — c'è un
 * `sheet_to_html` pronto ma restituisce HTML da mettere in `innerHTML`, e il
 * contenuto di un allegato è testo di qualcun altro. Una formula che contiene
 * `<script>` finisce a schermo come testo, che è esattamente ciò che è.
 *
 * Solo le prime righe: un listino da diecimila righe disegnato tutto blocca la
 * scheda, e chi apre l'anteprima vuole vedere **cos'è** il file, non lavorarci.
 */
const SHEET_ROW_LIMIT = 200;

/**
 * Oltre questa taglia il foglio non si apre a schermo. L'anteprima mostra le
 * prime duecento righe, ma per arrivarci il parser deve masticare **tutto** il
 * file: un allegato da decine di MB pianta la scheda, e un file costruito
 * apposta userebbe proprio quello. Sopra il limite si scarica, come per i
 * formati che il lettore non conosce (01/09/2026).
 */
const SHEET_MAX_BYTES = 5 * 1024 * 1024;

async function renderSheet(
  dati: ArrayBuffer,
  host: HTMLElement,
  annullato: () => boolean,
): Promise<void> {
  if (dati.byteLength > SHEET_MAX_BYTES) {
    const nota = document.createElement("p");
    nota.className = "p-4 text-center text-sm text-muted-foreground";
    nota.textContent = i18n.t(
      "Foglio troppo grande per l'anteprima ({{mb}} MB): scarica il file per aprirlo.",
      { mb: Math.round(dati.byteLength / 1024 / 1024) },
    );
    host.append(nota);
    return;
  }
  const XLSX = await import("xlsx");
  if (annullato()) return;
  // `cellDates`: le date escono come date e non come il numero seriale di Excel.
  const workbook = XLSX.read(dati, { type: "array", cellDates: true });

  for (const nome of workbook.SheetNames) {
    const foglio = workbook.Sheets[nome];
    if (!foglio) continue;
    // `header: 1` = righe come array, `raw: false` = i valori già formattati
    // come si vedono in Excel (date, percentuali, valute).
    const righe = XLSX.utils.sheet_to_json<Array<string | number | null>>(foglio, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });

    const titolo = document.createElement("h3");
    titolo.className = "mb-2 mt-4 text-sm font-semibold first:mt-0";
    titolo.textContent = nome;
    host.append(titolo);

    if (righe.length === 0) {
      const vuoto = document.createElement("p");
      vuoto.className = "mb-2 text-sm text-muted-foreground";
      vuoto.textContent = i18n.t("Foglio vuoto.");
      host.append(vuoto);
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "mb-2 overflow-x-auto rounded border bg-background";
    const table = document.createElement("table");
    table.className = "w-full border-collapse text-xs";

    for (const [indice, riga] of righe.slice(0, SHEET_ROW_LIMIT).entries()) {
      const tr = document.createElement("tr");
      // La prima riga fa da intestazione: è la convenzione di ogni foglio che
      // qualcuno allega, e senza il colpo d'occhio si perde.
      const intestazione = indice === 0;
      for (const cella of riga) {
        const td = document.createElement(intestazione ? "th" : "td");
        td.className = intestazione
          ? "border px-2 py-1 text-left font-semibold"
          : "border px-2 py-1 align-top";
        td.textContent = cella === null || cella === undefined ? "" : String(cella);
        tr.append(td);
      }
      table.append(tr);
    }

    wrapper.append(table);
    host.append(wrapper);

    if (righe.length > SHEET_ROW_LIMIT) {
      const nota = document.createElement("p");
      nota.className = "mb-4 text-xs text-muted-foreground";
      nota.textContent = i18n.t(
        "Prime {{mostrate}} righe di {{totali}}: scarica il file per vederlo tutto.",
        {
          mostrate: SHEET_ROW_LIMIT,
          totali: righe.length,
        },
      );
      host.append(nota);
    }
  }

  if (workbook.SheetNames.length === 0) {
    const vuoto = document.createElement("p");
    vuoto.className = "p-4 text-center text-sm text-muted-foreground";
    vuoto.textContent = i18n.t("Il foglio è vuoto.");
    host.append(vuoto);
  }
}

/** **Testo semplice**: `textContent` in un `<pre>`, nessuna libreria. */
function renderText(dati: ArrayBuffer, host: HTMLElement): void {
  const pre = document.createElement("pre");
  pre.className =
    "whitespace-pre-wrap break-words rounded border bg-background p-4 text-xs leading-relaxed";
  pre.textContent = decode(dati);
  host.append(pre);
}

/**
 * **Codice sorgente**, colorato. Il linguaggio viene dall'estensione
 * (`codeLanguage`); se non la riconosciamo, o se la grammatica non è fra quelle
 * previste, si mostra il testo senza colori — che è comunque meglio di un
 * download.
 *
 * L'evidenziatore sta in un **modulo a parte** e si carica solo qui dentro: le
 * ventisei righe di `import()` delle grammatiche, scritte in questo file,
 * entravano nel grafo di *chiunque* mostri un allegato — cioè quasi ogni
 * pagina — e il portale clienti ci metteva un secondo in più ad aprirsi
 * (18/08/2026, un test lo ha visto prima degli utenti).
 */
async function renderCode(dati: ArrayBuffer, host: HTMLElement, name: string): Promise<void> {
  const { highlightInto } = await import("./code-highlight");
  await highlightInto(decode(dati), name, host);
}

/**
 * **Markdown**. L'unico lettore che genera HTML da contenuto di qualcun altro,
 * quindi l'unico con delle guardie:
 *
 *  - l'**HTML grezzo dentro il documento si butta** (`renderer.html`): un `.md`
 *    può contenere `<img onerror=…>`, e non c'è motivo di onorarlo in
 *    un'anteprima;
 *  - i **collegamenti si ricontrollano dopo il disegno**: solo `http`/`https`
 *    sopravvivono, il resto diventa testo. `javascript:` in un link Markdown è
 *    la via più corta per far eseguire qualcosa a chi apre un allegato.
 */
async function renderMarkdown(dati: ArrayBuffer, host: HTMLElement): Promise<void> {
  const { Marked } = await import("marked");
  const marked = new Marked({
    async: false,
    gfm: true,
    breaks: true,
    renderer: { html: () => "" },
  });
  const article = document.createElement("article");
  article.className = "prose-sm max-w-none rounded border bg-background p-4 text-sm";
  article.innerHTML = marked.parse(decode(dati)) as string;

  for (const anchor of article.querySelectorAll("a")) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute("target", "_blank");
      // `noopener`: la pagina aperta non deve poter toccare questa.
      anchor.setAttribute("rel", "noopener noreferrer");
    } else {
      anchor.replaceWith(document.createTextNode(anchor.textContent ?? ""));
    }
  }
  host.append(article);
}
